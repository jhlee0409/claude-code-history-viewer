"""Portable source fixtures; never reads or writes the host's apt settings."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "ubuntu_apt_sources", Path(__file__).with_name("ubuntu-apt-sources.py")
)
assert SPEC is not None and SPEC.loader is not None
APT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APT)


class UbuntuSourcesTests(unittest.TestCase):
    def test_hosted_runner_deb822_mirror_is_replaced_without_losing_suites(self):
        # runner-images/configure-apt-sources.sh uses this mirror+file URI.
        source = """# Ubuntu archives
Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""
        expected = source.replace("mirror+file:/etc/apt/apt-mirrors.txt",
                                  "https://archive.ubuntu.com/ubuntu/")
        self.assertEqual(APT.normalize_sources(source, ".sources"), expected)


    def test_direct_urls_http_https_and_multiline_multiple_uris(self):
        for scheme in ("http", "https"):
            for host, target in (("azure.archive.ubuntu.com", "archive.ubuntu.com"),
                                 ("archive.ubuntu.com", "archive.ubuntu.com"),
                                 ("security.ubuntu.com", "security.ubuntu.com")):
                with self.subTest(scheme=scheme, host=host):
                    source = ("Types: deb deb-src\nURIs:\n"
                              f" {scheme}://{host}/ubuntu/\n"
                              " https://packages.microsoft.com/ubuntu/24.04/prod\n"
                              "Suites: noble noble-security\nComponents: main universe\n"
                              "Architectures: amd64\nSigned-By: /keyring.gpg\n")
                    expected = source.replace(f"{scheme}://{host}/ubuntu/",
                                              f"https://{target}/ubuntu/")
                    self.assertEqual(APT.normalize_sources(source, ".sources"), expected)

    def test_legacy_list_options_comments_and_deb_src(self):
        source = ("# deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
                  "deb [arch=amd64 signed-by=/keyring.gpg] "
                  "http://azure.archive.ubuntu.com/ubuntu noble main # retain\n"
                  "deb-src mirror+file:/etc/apt/apt-mirrors.txt noble-security main\n")
        expected = ("# deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
                    "deb [arch=amd64 signed-by=/keyring.gpg] "
                    "https://archive.ubuntu.com/ubuntu noble main # retain\n"
                    "deb-src https://archive.ubuntu.com/ubuntu/ noble-security main\n")
        self.assertEqual(APT.normalize_sources(source, ".list"), expected)

    def test_disabled_stanza_comments_and_unrelated_fields_are_untouched(self):
        source = ("# URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
                  "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
                  "Enabled: no\nSuites: noble\nComponents: main\n\n"
                  "Types: deb\nURIs: https://example.com/repo\n"
                  "X-Note: http://azure.archive.ubuntu.com/ubuntu\n"
                  "Suites: stable\nComponents: main\n")
        self.assertEqual(APT.normalize_sources(source, ".sources"), source)

    def test_arm_ports_third_party_unknown_mirrors_and_lookalikes_are_untouched(self):
        urls = ("http://ports.ubuntu.com/ubuntu-ports/",
                "https://packages.microsoft.com/ubuntu/24.04/prod",
                "https://ppa.launchpadcontent.net/example/ppa/ubuntu",
                "mirror+file:/etc/apt/other-mirrors.txt",
                "http://azure.archive.ubuntu.com.evil/ubuntu",
                "http://archive.ubuntu.com/custom",
                "http://archive.ubuntu.com:8080/ubuntu",
                "http://user@archive.ubuntu.com/ubuntu")
        for url in urls:
            for suffix, source in ((".sources", f"Types: deb\nURIs: {url}\nArchitectures: arm64\nSuites: noble\nComponents: main\n"),
                                   (".list", f"deb [arch=arm64] {url} noble main\n")):
                with self.subTest(url=url, suffix=suffix):
                    self.assertEqual(APT.normalize_sources(source, suffix), source)

    def test_comments_between_uri_continuations_and_inline_key_remain(self):
        source = ("Types: deb\nurIS: http://archive.ubuntu.com/ubuntu\n"
                  "# mirror note\n https://security.ubuntu.com/ubuntu\n"
                  "Suites: noble\nComponents: main\nSigned-By:\n"
                  " -----BEGIN PGP PUBLIC KEY BLOCK-----\n .\n abc\n"
                  " -----END PGP PUBLIC KEY BLOCK-----\n")
        expected = source.replace("http://archive.ubuntu.com", "https://archive.ubuntu.com")
        self.assertEqual(APT.normalize_sources(source, ".sources"), expected)

    def test_idempotent_preserves_crlf_and_no_final_newline(self):
        source = "deb http://azure.archive.ubuntu.com/ubuntu/ noble main\r\n# end"
        expected = source.replace("http://azure.archive.ubuntu.com", "https://archive.ubuntu.com")
        first = APT.normalize_sources(source, ".list")
        self.assertEqual(first, expected)
        self.assertEqual(APT.normalize_sources(first, ".list"), first)

    def test_duplicate_fields_and_malformed_deb822_fail_closed(self):
        for source in ("Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nURIs: https://example.com\n",
                       "Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\ninvalid field\n"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                APT.normalize_sources(source, ".sources")

    def run_cli(self, root):
        return subprocess.run([sys.executable, "-B", str(Path(APT.__file__)),
                               "--apt-root", str(root)], capture_output=True, text=True)

    def test_cli_only_active_source_files_backup_unchanged_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parts = root / "sources.list.d"
            parts.mkdir()
            original = "deb http://azure.archive.ubuntu.com/ubuntu noble-security main\n"
            active = root / "sources.list"
            active.write_text(original)
            active.chmod(0o640)
            backup = parts / "ubuntu.list.save"
            backup.write_text(original)
            unrelated = parts / "microsoft.list"
            unrelated.write_text("deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n")
            first = self.run_cli(root)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("https://archive.ubuntu.com/ubuntu", active.read_text())
            self.assertEqual(active.stat().st_mode & 0o777, 0o640)
            self.assertEqual(backup.read_text(), original)
            self.assertEqual(unrelated.read_text(), "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n")
            stamp = active.stat().st_mtime_ns
            second = self.run_cli(root)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(active.stat().st_mtime_ns, stamp)

    def test_cli_validates_all_sources_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parts = root / "sources.list.d"
            parts.mkdir()
            source = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
            active = root / "sources.list"
            active.write_text(source)
            (parts / "bad.sources").write_text("Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\ninvalid\n")
            result = self.run_cli(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(active.read_text(), source)

    def test_cli_rejects_unknown_source_layout_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = "deb mirror+file:/etc/apt/unknown.txt noble main\n"
            (root / "sources.list").write_text(source)
            result = self.run_cli(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((root / "sources.list").read_text(), source)

    def test_cli_deb822_runner_layout_and_existing_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parts = root / "sources.list.d"
            parts.mkdir()
            (root / "sources.list").write_text("# See sources.list.d/ubuntu.sources\n")
            source = ("Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
                      "Suites: noble noble-updates noble-backports\n"
                      "Components: main restricted universe multiverse\n"
                      "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\n"
                      "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
                      "Suites: noble-security\nComponents: main restricted universe multiverse\n"
                      "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n")
            active = parts / "ubuntu.sources"
            active.write_text(source)
            backup = parts / "ubuntu.sources.bak"
            backup.write_text(source)
            result = self.run_cli(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(active.read_text(), source.replace(APT.MIRROR, "https://archive.ubuntu.com/ubuntu/"))
            self.assertEqual(backup.read_text(), source)

    def test_cli_ignores_disabled_known_uri_when_checking_supported_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parts = root / "sources.list.d"
            parts.mkdir()
            source = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nEnabled: no\n"
            (parts / "disabled.sources").write_text(source)
            self.assertNotEqual(self.run_cli(root).returncode, 0)
            self.assertEqual((parts / "disabled.sources").read_text(), source)

    def test_cli_rejects_symlinks_without_writing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "original"
            source = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
            target.write_text(source)
            (root / "sources.list").symlink_to(target)
            self.assertNotEqual(self.run_cli(root).returncode, 0)
            self.assertEqual(target.read_text(), source)


if __name__ == "__main__":
    unittest.main()
