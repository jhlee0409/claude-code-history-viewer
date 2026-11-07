use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(5);
const REAP_TIMEOUT: Duration = Duration::from_millis(250);

pub(super) fn run(executable: &Path, args: &[&OsStr], cwd: &Path) -> Result<String, String> {
    run_with_limits(executable, args, cwd, TIMEOUT, MAX_BYTES)
}

struct Renderer {
    child: Child,
    #[cfg(windows)]
    job: platform::Job,
}

impl Renderer {
    fn spawn(command: &mut Command) -> Result<Self, String> {
        platform::configure(command);
        #[cfg(windows)]
        let job = platform::Job::new().map_err(|e| format!("renderer_failed: {e}"))?;
        let child = command
            .spawn()
            .map_err(|e| format!("renderer_missing: {e}"))?;
        let renderer = Self {
            child,
            #[cfg(windows)]
            job,
        };
        #[cfg(windows)]
        {
            renderer
                .job
                .assign(&renderer.child)
                .and_then(|()| platform::resume(&renderer.child))
                .map_err(|e| format!("renderer_failed: cannot contain renderer: {e}"))?;
        }
        Ok(renderer)
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        #[cfg(unix)]
        platform::terminate_group(self.child.id());
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.kill();
        // Never join an unbounded pipe reader or block forever in Child::wait.
        let deadline = Instant::now() + REAP_TIMEOUT;
        loop {
            match self.child.try_wait() {
                Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL_INTERVAL),
                _ => break,
            }
        }
    }
}

fn read_available(
    stream: &mut impl platform::Pipe,
    bytes: &mut Vec<u8>,
    max_bytes: usize,
) -> Result<bool, String> {
    let mut buffer = [0; 8192];
    match platform::read_available(stream, &mut buffer) {
        Ok(Some(0)) => Ok(true),
        Ok(Some(count)) => {
            if count > max_bytes.saturating_sub(bytes.len()) {
                return Err("renderer_output: document or diagnostics exceed size limit".into());
            }
            bytes.extend_from_slice(&buffer[..count]);
            Ok(false)
        }
        Ok(None) => Ok(false),
        Err(error) => Err(format!("renderer_output: {error}")),
    }
}

fn run_with_limits(
    executable: &Path,
    args: &[&OsStr],
    cwd: &Path,
    timeout: Duration,
    max_bytes: usize,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .env("PYTHONSAFEPATH", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut renderer = Renderer::spawn(&mut command)?;
    let mut stdout = renderer
        .child
        .stdout
        .take()
        .ok_or("renderer stdout unavailable")?;
    let mut stderr = renderer
        .child
        .stderr
        .take()
        .ok_or("renderer stderr unavailable")?;
    platform::prepare_pipe(&stdout).map_err(|e| format!("renderer_output: {e}"))?;
    platform::prepare_pipe(&stderr).map_err(|e| format!("renderer_output: {e}"))?;
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut status = None;
    loop {
        if Instant::now() >= deadline {
            return Err("renderer_timeout: reading generation exceeded deadline".into());
        }
        let previous_bytes = output.len() + diagnostics.len();
        if !stdout_closed {
            stdout_closed = read_available(&mut stdout, &mut output, max_bytes)?;
        }
        if !stderr_closed {
            stderr_closed = read_available(&mut stderr, &mut diagnostics, max_bytes)?;
        }
        if status.is_none() {
            status = renderer
                .child
                .try_wait()
                .map_err(|e| format!("renderer_failed: {e}"))?;
        }
        // A successful leader exit alone is not completion: descendants may
        // still own either pipe. The same deadline covers both drains.
        if let Some(status) = status.filter(|_| stdout_closed && stderr_closed) {
            if !status.success() {
                return Err(format!("renderer_failed: exited with {status}"));
            }
            return String::from_utf8(output).map_err(|_| "renderer_output: invalid UTF-8".into());
        }
        if previous_bytes == output.len() + diagnostics.len() {
            std::thread::sleep(
                POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }
}

#[cfg(unix)]
mod platform {
    use super::{io, Command, Read};
    use std::os::fd::AsRawFd;
    use std::os::unix::process::CommandExt;

    pub trait Pipe: Read + AsRawFd {}
    impl<T: Read + AsRawFd> Pipe for T {}

    pub fn configure(command: &mut Command) {
        command.process_group(0);
    }

    #[allow(unsafe_code)]
    pub fn prepare_pipe(pipe: &impl Pipe) -> io::Result<()> {
        // The descriptors belong to this invocation and remain alive throughout
        // these calls; setting nonblocking affects only our read end.
        let flags = unsafe { libc::fcntl(pipe.as_raw_fd(), libc::F_GETFL) };
        if flags < 0
            || unsafe { libc::fcntl(pipe.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn read_available(pipe: &mut impl Pipe, bytes: &mut [u8]) -> io::Result<Option<usize>> {
        match pipe.read(bytes) {
            Ok(count) => Ok(Some(count)),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    #[allow(unsafe_code)]
    pub fn terminate_group(id: u32) {
        if let Ok(id) = libc::pid_t::try_from(id) {
            // process_group(0) makes the spawned child its own group leader.
            // Never signal our caller's group or a user-supplied process ID.
            unsafe { libc::kill(-id, libc::SIGKILL) };
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::{io, Child, Command, Read};
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_BROKEN_PIPE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Pipes::PeekNamedPipe;
    use windows_sys::Win32::System::Threading::{
        OpenThread, ResumeThread, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
    };

    pub trait Pipe: Read + AsRawHandle {}
    impl<T: Read + AsRawHandle> Pipe for T {}

    pub fn configure(command: &mut Command) {
        // Assign the job before any renderer code can spawn descendants.
        command.creation_flags(CREATE_SUSPENDED);
    }

    #[allow(unsafe_code)]
    pub fn resume(child: &Child) -> io::Result<()> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut found = unsafe { Thread32First(snapshot, &mut entry) } != 0;
        let result = loop {
            if !found {
                break Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "renderer thread unavailable",
                ));
            }
            if entry.th32OwnerProcessID == child.id() {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    break Err(io::Error::last_os_error());
                }
                let resumed = unsafe { ResumeThread(thread) };
                let error = io::Error::last_os_error();
                unsafe { CloseHandle(thread) };
                break if resumed == u32::MAX {
                    Err(error)
                } else {
                    Ok(())
                };
            }
            found = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
        };
        unsafe { CloseHandle(snapshot) };
        result
    }
    pub fn prepare_pipe(_pipe: &impl Pipe) -> io::Result<()> {
        Ok(())
    }

    #[allow(unsafe_code)]
    pub fn read_available(pipe: &mut impl Pipe, bytes: &mut [u8]) -> io::Result<Option<usize>> {
        let mut available = 0;
        // There is exactly one reader, so bytes reported here remain available
        // for the following bounded read. No blocking pipe-reader thread exists.
        if unsafe {
            PeekNamedPipe(
                pipe.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                Ok(Some(0))
            } else {
                Err(error)
            };
        }
        if available == 0 {
            return Ok(None);
        }
        let count = bytes.len().min(available as usize);
        pipe.read(&mut bytes[..count]).map(Some)
    }

    pub struct Job(HANDLE);

    impl Job {
        #[allow(unsafe_code)]
        pub fn new() -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }

        #[allow(unsafe_code)]
        pub fn assign(&self, child: &Child) -> io::Result<()> {
            if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        #[allow(unsafe_code)]
        pub fn terminate(&self) {
            unsafe { TerminateJobObject(self.0, 1) };
        }
    }

    impl Drop for Job {
        #[allow(unsafe_code)]
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn shell(script: &str, timeout: Duration, limit: usize) -> (Result<String, String>, Duration) {
        let directory = tempfile::tempdir().unwrap();
        let started = Instant::now();
        let result = run_with_limits(
            Path::new("/bin/sh"),
            &[OsStr::new("-c"), OsStr::new(script)],
            directory.path(),
            timeout,
            limit,
        );
        (result, started.elapsed())
    }

    #[test]
    fn deadline_includes_pipes_inherited_after_parent_exit() {
        let (result, elapsed) = shell("sleep 1 & printf done", Duration::from_millis(80), 1024);
        assert!(elapsed < Duration::from_millis(700), "elapsed: {elapsed:?}");
        assert!(result.unwrap_err().starts_with("renderer_timeout:"));
    }

    #[test]
    fn deadline_includes_pipes_inherited_after_parent_kill() {
        let (result, elapsed) = shell("sleep 1 & wait", Duration::from_millis(80), 1024);
        assert!(elapsed < Duration::from_millis(700), "elapsed: {elapsed:?}");
        assert!(result.unwrap_err().starts_with("renderer_timeout:"));
    }

    #[test]
    fn timeout_terminates_descendants_in_spawned_group() {
        let directory = tempfile::tempdir().unwrap();
        let result = run_with_limits(
            Path::new("/bin/sh"),
            &[
                OsStr::new("-c"),
                OsStr::new("(sleep 0.3; printf survived > descendant-survived) & printf done"),
            ],
            directory.path(),
            Duration::from_millis(80),
            1024,
        );
        assert!(result.unwrap_err().starts_with("renderer_timeout:"));
        std::thread::sleep(Duration::from_millis(350));
        assert!(!directory.path().join("descendant-survived").exists());
    }

    #[test]
    fn returns_stdout_on_success() {
        assert_eq!(
            shell("printf rendered", TIMEOUT, 1024).0.unwrap(),
            "rendered"
        );
    }

    #[test]
    fn rejects_stdout_limit_before_renderer_exits() {
        let (result, elapsed) = shell("printf 12345; sleep 1", Duration::from_secs(2), 4);
        assert!(elapsed < Duration::from_millis(700), "elapsed: {elapsed:?}");
        assert!(result.unwrap_err().starts_with("renderer_output:"));
    }

    #[test]
    fn rejects_stderr_limit_before_renderer_exits() {
        let (result, elapsed) = shell("printf 12345 >&2; sleep 1", Duration::from_secs(2), 4);
        assert!(elapsed < Duration::from_millis(700), "elapsed: {elapsed:?}");
        assert!(result.unwrap_err().starts_with("renderer_output:"));
    }

    #[test]
    fn rejects_nonzero_exit_and_invalid_utf8() {
        assert!(shell("exit 7", TIMEOUT, 1024)
            .0
            .unwrap_err()
            .starts_with("renderer_failed:"));
        assert!(shell("printf '\\377'", TIMEOUT, 1024)
            .0
            .unwrap_err()
            .contains("invalid UTF-8"));
    }

    #[test]
    fn keeps_staged_working_directory_and_python_safe_path() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("staged"), "snapshot").unwrap();
        let result = run_with_limits(
            Path::new("/bin/sh"),
            &[OsStr::new("-c"), OsStr::new("test -z \"${PYTHONPATH+x}\" && test -z \"${PYTHONHOME+x}\" && test \"$PYTHONSAFEPATH\" = 1 && /bin/cat staged")],
            directory.path(),
            TIMEOUT,
            1024,
        );
        assert_eq!(result.unwrap(), "snapshot");
    }
}
