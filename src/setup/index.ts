/**
 * Setup module barrel export
 * Exports the setup wizard functionality
 */

export { runSetupWizard, validateEnvironment, buildWindowsShimSuggestion } from "./wizard.js";
export type {
  ValidationResult,
  GeminiInstallCheck,
  HostConfigSuggestion,
} from "./wizard.js";
