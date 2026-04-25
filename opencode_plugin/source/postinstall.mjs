import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_CONFIG_BASENAME = "development-board-toolchain.runtime.json"
const RUNTIME_TEMPLATE_BASENAME = "development-board-toolchain.runtime.template.json"

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || ""
}

function defaultInstallRoot() {
  return path.join(homeDir(), "Library", "development-board-toolchain")
}

function defaultRuntimeRoot() {
  return (
    process.env.DBT_OPENCODE_RUNTIME_ROOT ||
    process.env.DBT_TOOLKIT_ROOT ||
    process.env.OPENCODE_DBT_ROOT ||
    path.join(defaultInstallRoot(), "runtime")
  )
}

function defaultWorkspaceRoot(runtimeRoot) {
  return path.join(path.dirname(runtimeRoot), "workspaces")
}

function runtimeTemplatePath() {
  return path.join(PACKAGE_DIR, RUNTIME_TEMPLATE_BASENAME)
}

function runtimeConfigPath() {
  return path.join(PACKAGE_DIR, RUNTIME_CONFIG_BASENAME)
}

function readJSON(targetPath) {
  try {
    return JSON.parse(readFileSync(targetPath, "utf8"))
  } catch {
    return {}
  }
}

function writeRuntimeConfig() {
  const runtimeRoot = defaultRuntimeRoot()
  const workspaceRoot = defaultWorkspaceRoot(runtimeRoot)
  const targetPath = runtimeConfigPath()
  const template = existsSync(runtimeTemplatePath()) ? readJSON(runtimeTemplatePath()) : {}
  const current = existsSync(targetPath) ? readJSON(targetPath) : {}

  const nextConfig = {
    ...template,
    ...current,
    toolkitRoot: runtimeRoot,
    updateManifestURL: current.updateManifestURL || template.updateManifestURL || "https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/opencode-plugin-release-manifest.json",
    updateRepository: current.updateRepository || template.updateRepository || "https://github.com/kkwell/DBT-Agent-Plugins.git",
    updateVersionURL: current.updateVersionURL || template.updateVersionURL || "https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/VERSION",
    localAgentURL: current.localAgentURL || template.localAgentURL || "http://127.0.0.1:18082",
    workspaceRoot,
    insightUploadEnabled: typeof current.insightUploadEnabled === "boolean"
      ? current.insightUploadEnabled
      : (typeof template.insightUploadEnabled === "boolean" ? template.insightUploadEnabled : false),
  }

  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, JSON.stringify(nextConfig, null, 2) + "\n", "utf8")
  console.log(`dbt-agent: wrote runtime config ${targetPath}`)
}

writeRuntimeConfig()
