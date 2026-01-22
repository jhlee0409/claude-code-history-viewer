import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Mail, Copy, RefreshCw, CheckCircle2, HelpCircle } from "lucide-react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props extends WithTranslation {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

class ErrorBoundaryComponent extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
    window.location.reload();
  };

  copyErrorDetails = () => {
    const { error, errorInfo } = this.state;
    const { t } = this.props;
    const errorDetails = `
${t("error.copyTemplate.header", { defaultValue: "Error Information:" })}
${t("error.copyTemplate.separator", { defaultValue: "---------" })}
${t("error.copyTemplate.errorMessage", {
  message: error?.message || "Unknown error",
  defaultValue: "Error Message: {{message}}",
})}
${t("error.copyTemplate.errorStack", {
  stack: error?.stack || "No stack trace",
  defaultValue: "Error Stack: {{stack}}",
})}

${t("error.copyTemplate.componentStack", {
  defaultValue: "Component Stack:",
})}
${errorInfo?.componentStack || "No component stack"}

${t("error.copyTemplate.browserInfo", {
  defaultValue: "Browser Information:",
})}
${navigator.userAgent}

${t("error.copyTemplate.timestamp", {
  time: new Date().toISOString(),
  defaultValue: "Occurrence Time: {{time}}",
})}
    `;

    navigator.clipboard.writeText(errorDetails);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      const emailSubject = encodeURIComponent(
        t("error.emailTemplate.subject", {
          error: this.state.error?.message || "Unknown error",
          defaultValue: "[Claude Code History Viewer] Error Report: {{error}}",
        })
      );
      const emailBody = encodeURIComponent(`
${t("error.emailTemplate.greeting", {
  defaultValue: "Hello,",
})}

${t("error.emailTemplate.description", {
  defaultValue:
    "I encountered the following error while using Claude Code History Viewer:",
})}

${t("error.emailTemplate.placeholder", {
  defaultValue: "[Please paste the copied error information here]",
})}

${t("error.emailTemplate.additionalInfo", {
  defaultValue: "Additional Information:",
})}
${t("error.emailTemplate.whatWereDoing", {
  defaultValue: "- What were you doing when the error occurred?",
})}
${t("error.emailTemplate.isRepeating", {
  defaultValue: "- Does this error occur repeatedly?",
})}
${t("error.emailTemplate.otherNotes", {
  defaultValue: "- Other notes:",
})}

${t("error.emailTemplate.thanks", {
  defaultValue: "Thank you.",
})}

      `);

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <Card className="max-w-2xl w-full shadow-lg">
            <CardContent className="p-8">
              {/* Header */}
              <div className="text-center mb-6">
                <div className="flex justify-center mb-4">
                  <div className="rounded-full bg-destructive/10 p-4">
                    <AlertTriangle className="h-12 w-12 text-destructive" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold mb-2 text-foreground">
                  {t("error.unexpectedError", {
                    defaultValue: "An unexpected error occurred",
                  })}
                </h1>
                <p className="text-muted-foreground">
                  {t("error.apologize", {
                    defaultValue:
                      "We apologize for the inconvenience. Please try the following solutions to resolve the issue.",
                  })}
                </p>
              </div>

              {/* Error Details */}
              <Alert variant="destructive" className="mb-6">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {t("error.errorInfo", {
                    defaultValue: "Error Information",
                  })}
                </AlertTitle>
                <AlertDescription>
                  <pre className="text-sm overflow-x-auto whitespace-pre-wrap mt-2">
                    {this.state.error?.message || "Unknown error"}
                  </pre>
                  {this.state.error?.stack && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-destructive/80 hover:text-destructive">
                        {t("error.viewDetails", {
                          defaultValue: "View Details",
                        })}
                      </summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-destructive/70">
                        {this.state.error.stack}
                      </pre>
                    </details>
                  )}
                </AlertDescription>
              </Alert>

              {/* Report Error Section */}
              <Alert variant="info" className="mb-6">
                <Mail className="h-4 w-4" />
                <AlertTitle>
                  {t("error.reportError", {
                    defaultValue: "Report Error",
                  })}
                </AlertTitle>
                <AlertDescription>
                  <p className="text-sm mb-3">
                    {t("error.reportDescription", {
                      defaultValue:
                        "If this error occurs repeatedly, please report it to the email below:",
                    })}
                  </p>
                  <div className="flex flex-col gap-3">
                    <a
                      href={`mailto:relee6203@gmail.com?subject=${emailSubject}&body=${emailBody}`}
                      className="text-sm font-medium text-info hover:underline"
                    >
                      relee6203@gmail.com
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={this.copyErrorDetails}
                      className="w-fit"
                    >
                      {this.state.copied ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {this.state.copied
                        ? t("error.copied", {
                            defaultValue: "Copied!",
                          })
                        : t("error.copyErrorInfo", {
                            defaultValue: "Copy Error Information",
                          })}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Restart Button */}
              <div className="flex justify-center mb-6">
                <Button onClick={this.handleReset} size="lg">
                  <RefreshCw className="h-4 w-4" />
                  {t("error.restartApp", {
                    defaultValue: "Restart App",
                  })}
                </Button>
              </div>

              {/* Troubleshooting */}
              <Card variant="outline" className="bg-muted/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <HelpCircle className="h-4 w-4" />
                    {t("error.troubleshooting", {
                      defaultValue: "Troubleshooting",
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-muted-foreground/60">•</span>
                      {t("error.troubleshootingSteps.restart", {
                        defaultValue:
                          "Try completely closing and restarting the app",
                      })}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-muted-foreground/60">•</span>
                      {t("error.troubleshootingSteps.updateVersion", {
                        defaultValue:
                          "Ensure you have the latest version of Claude Code History Viewer installed",
                      })}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-muted-foreground/60">•</span>
                      {t("error.troubleshootingSteps.tryOtherProject", {
                        defaultValue:
                          "Try opening a different project to see if the issue persists",
                      })}
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation("components")(
  ErrorBoundaryComponent
);
