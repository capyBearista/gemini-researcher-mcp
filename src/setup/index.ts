/**
 * Setup module barrel export
 * Exports the setup wizard functionality
 */

export { runSetupWizard, validateEnvironment } from "./wizard.js";
export type {
  ValidationResult,
  GeminiInstallCheck,
  AuthCheck,
} from "./wizard.js";
