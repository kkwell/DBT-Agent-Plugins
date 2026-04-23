import { tool } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"
import https from "node:https"

const execFileAsync = promisify(execFile)

function homeDir() {
  return process.env.HOME || ""
}

function runtimeConfigPath() {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "development-board-toolchain.runtime.json")
}

function pluginBaseDir() {
  return path.dirname(new URL(import.meta.url).pathname)
}

function opencodeConfigRoot() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(homeDir(), ".config", "opencode")
}

function defaultStandaloneRuntimeRoot() {
  return path.join(homeDir(), "Library", "Application Support", "development-board-toolchain", "runtime")
}

function readRuntimeConfig() {
  try {
    const runtimePath = runtimeConfigPath()
    if (!existsSync(runtimePath)) return {}
    const parsed = JSON.parse(readFileSync(runtimePath, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function readRuntimeToolkitRoot() {
  const parsed = readRuntimeConfig()
  return typeof parsed.toolkitRoot === "string" ? parsed.toolkitRoot : ""
}

function localAgentBaseURL() {
  const runtime = readRuntimeConfig()
  return (
    asString(process.env.OPENCODE_DBT_AGENTD_URL) ||
    asString(process.env.DBT_AGENTD_URL) ||
    asString(runtime.localAgentURL) ||
    "http://127.0.0.1:18082"
  )
}

function localAgentToken() {
  return (
    asString(process.env.OPENCODE_DBT_AGENTD_TOKEN) ||
    asString(process.env.DBT_AGENTD_TOKEN)
  )
}

function resolveUpdateManifestSource() {
  const runtime = readRuntimeConfig()
  return (
    asString(process.env.DBT_OPENCODE_UPDATE_MANIFEST_URL) ||
    asString(process.env.OPENCODE_DBT_UPDATE_MANIFEST_URL) ||
    asString(runtime.updateManifestURL) ||
    "https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/opencode-plugin-release-manifest.json"
  )
}

function updateStatePath() {
  return path.join(pluginBaseDir(), "development-board-toolchain.update-state.json")
}

function readUpdateState() {
  try {
    const target = updateStatePath()
    if (!existsSync(target)) return {}
    const parsed = JSON.parse(readFileSync(target, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeUpdateState(nextState) {
  try {
    writeFileSync(updateStatePath(), JSON.stringify(nextState, null, 2) + "\n", "utf8")
  } catch {
    // ignore cache write failures
  }
}

function isoNow() {
  return new Date().toISOString()
}

function defaultClientContext() {
  const clientID = asString(process.env.OPENCODE_CLIENT_ID) || "opencode"
  const sessionID =
    asString(process.env.OPENCODE_SESSION_ID) ||
    `opencode-pid-${process.pid}`
  const requestID = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    client_id: clientID,
    session_id: sessionID,
    client_type: "opencode",
    request_id: requestID,
  }
}

function withClientContext(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload
  }
  const context = defaultClientContext()
  const nested =
    payload.request_context && typeof payload.request_context === "object" && !Array.isArray(payload.request_context)
      ? payload.request_context
      : {}
  return {
    ...payload,
    client_id: asString(payload.client_id) || context.client_id,
    session_id: asString(payload.session_id) || context.session_id,
    client_type: asString(payload.client_type) || context.client_type,
    request_id: asString(payload.request_id) || context.request_id,
    request_context: {
      client_id: asString(nested.client_id) || asString(payload.client_id) || context.client_id,
      session_id: asString(nested.session_id) || asString(payload.session_id) || context.session_id,
      client_type: asString(nested.client_type) || asString(payload.client_type) || context.client_type,
      request_id: asString(nested.request_id) || asString(payload.request_id) || context.request_id,
    },
  }
}

function defaultToolEventRawRoot() {
  return path.join(
    homeDir(),
    "Library",
    "Application Support",
    "development-board-toolchain",
    "agent",
    "insights",
    "raw",
    "tool-events",
  )
}

function toolEventSensitiveKey(key) {
  const lowered = String(key || "").trim().toLowerCase()
  return [
    "password",
    "passphrase",
    "psk",
    "token",
    "api_key",
    "apikey",
    "secret",
    "authorization",
    "cookie",
    "credential",
    "credentials",
    "bearer",
    "otp",
    "mfa",
  ].some((item) => lowered.includes(item))
}

function toolEventPathKey(key) {
  const lowered = String(key || "").trim().toLowerCase()
  return ["path", "file", "dir", "root", "workspace"].some((item) => lowered.includes(item))
}

function toolEventLargeContentKey(key) {
  const lowered = String(key || "").trim().toLowerCase()
  return [
    "source",
    "request",
    "content",
    "markdown",
    "evidence",
    "stdout",
    "stderr",
    "output",
    "log",
    "logs",
    "prompt",
  ].some((item) => lowered.includes(item))
}

function compactTelemetryPath(raw) {
  const normalized = String(raw || "").replaceAll("\\", "/").trim()
  if (!normalized) return ""
  const parts = normalized.split("/").filter(Boolean)
  if (!parts.length) return normalized
  if (parts.length === 1) return parts[0]
  return `.../${parts.slice(-2).join("/")}`
}

function sanitizeToolEventValue(value, keyPath = []) {
  const currentKey = String(keyPath[keyPath.length - 1] || "")
  if (value == null) return null
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeToolEventValue(item, keyPath.concat("[]")))
  }
  if (typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sanitizeToolEventValue(value[key], keyPath.concat(key))
    }
    return out
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value
  }
  const text = String(value || "").trim()
  if (!text) return ""
  if (toolEventSensitiveKey(currentKey)) {
    return "<redacted>"
  }
  if (toolEventPathKey(currentKey)) {
    return compactTelemetryPath(text)
  }
  if (toolEventLargeContentKey(currentKey)) {
    return `<omitted len=${text.length}>`
  }
  if (text.length > 512) {
    return `${text.slice(0, 512)}...(truncated len=${text.length})`
  }
  return text
}

function buildToolEventPayload(partial = {}) {
  const payload = withClientContext({
    source: "opencode_plugin",
    ...partial,
  })
  const toolArguments =
    partial.tool_arguments && typeof partial.tool_arguments === "object" && !Array.isArray(partial.tool_arguments)
      ? partial.tool_arguments
      : {}
  return {
    protocol_version: "dbt-tool-event-v1",
    source: "opencode_plugin",
    occurred_at: asString(payload.occurred_at) || isoNow(),
    event_stage: asString(payload.event_stage) || "plugin_transport",
    transport: asString(payload.transport) || "opencode_local_http",
    tool_name: asString(payload.tool_name) || asString(payload.operation_name) || "unknown_tool",
    request_context:
      payload.request_context && typeof payload.request_context === "object" && !Array.isArray(payload.request_context)
        ? payload.request_context
        : defaultClientContext(),
    tool_arguments: sanitizeToolEventValue(toolArguments, ["tool_arguments"]),
    ok: payload.ok === true,
    retryable: payload.retryable === true,
    duration_ms: Number.isFinite(Number(payload.duration_ms)) ? Math.max(0, Math.floor(Number(payload.duration_ms))) : undefined,
    board_id: asString(payload.board_id) || asString(toolArguments.board_id) || asString(toolArguments.board),
    variant_id: asString(payload.variant_id) || asString(toolArguments.variant_id) || asString(toolArguments.variant),
    capability_id: asString(payload.capability_id) || asString(toolArguments.capability_id) || asString(toolArguments.capability),
    device_id: asString(payload.device_id) || asString(toolArguments.device_id),
    error_code: asString(payload.error_code),
    error_message: excerptText(asString(payload.error_message || payload.error || "")),
    summary_for_user: excerptText(asString(payload.summary_for_user || payload.summary || "")),
    stdout_excerpt: excerptText(asString(payload.stdout_excerpt || "")),
    stderr_excerpt: excerptText(asString(payload.stderr_excerpt || "")),
    metadata: sanitizeToolEventValue(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}, ["metadata"]),
  }
}

function writeFallbackToolEvent(eventPayload) {
  try {
    const occurredAt = asString(eventPayload.occurred_at) || isoNow()
    const dateBucket = occurredAt.slice(0, 10) || "unknown-date"
    const root = path.join(defaultToolEventRawRoot(), dateBucket)
    mkdirSync(root, { recursive: true })
    const target = path.join(
      root,
      `tool-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`,
    )
    writeFileSync(target, JSON.stringify(eventPayload, null, 2) + "\n", "utf8")
  } catch {
    // ignore emergency fallback write failures
  }
}

async function bestEffortSubmitToolEvent(partial = {}) {
  const payload = buildToolEventPayload(partial)
  try {
    const url = new URL("/v1/tool-events/submit", localAgentBaseURL()).toString()
    await requestJSON(url, {
      method: "POST",
      payload,
      timeoutMs: 1500,
    })
    return
  } catch {
    writeFallbackToolEvent(payload)
  }
}

async function requestJSON(urlText, options = {}) {
  if (!isHttpURL(urlText)) {
    const target = path.resolve(asString(urlText))
    if (!existsSync(target)) {
      throw new Error(`json source not found: ${target}`)
    }
    return JSON.parse(readFileSync(target, "utf8"))
  }

  const url = new URL(urlText)
  const method = (options.method || "GET").toUpperCase()
  const payload = options.payload ?? null
  const timeoutMs = Number(options.timeoutMs || 8000)
  const body = payload == null ? null : Buffer.from(JSON.stringify(payload))
  const headers = {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json", "Content-Length": String(body.length) } : {}),
  }
  const token = localAgentToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const transport = url.protocol === "https:" ? https : http

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          data += chunk
        })
        res.on("end", () => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const redirectURL = new URL(res.headers.location, url).toString()
            requestJSON(redirectURL, options).then(resolve).catch(reject)
            return
          }
          const text = String(data || "").trim()
          let parsed = null
          if (text) {
            try {
              parsed = JSON.parse(text)
            } catch {
              reject(new Error(`invalid json from ${url.pathname}: ${text}`))
              return
            }
          } else {
            parsed = {}
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text || "request failed"}`))
            return
          }
          resolve(parsed)
        })
      },
    )
    req.on("error", reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`))
    })
    if (body) req.write(body)
    req.end()
  })
}

async function requestText(urlText, options = {}) {
  if (!isHttpURL(urlText)) {
    const target = path.resolve(asString(urlText))
    if (!existsSync(target)) {
      throw new Error(`text source not found: ${target}`)
    }
    return readFileSync(target, "utf8")
  }

  const url = new URL(urlText)
  const method = (options.method || "GET").toUpperCase()
  const timeoutMs = Number(options.timeoutMs || 8000)
  const headers = {
    Accept: "text/plain, */*",
  }
  const token = localAgentToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const transport = url.protocol === "https:" ? https : http

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          data += chunk
        })
        res.on("end", () => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const redirectURL = new URL(res.headers.location, url).toString()
            requestText(redirectURL, options).then(resolve).catch(reject)
            return
          }
          const text = String(data || "")
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.trim() || "request failed"}`))
            return
          }
          resolve(text)
        })
      },
    )
    req.on("error", reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`))
    })
    req.end()
  })
}

async function localAgentJSON(pathname, options = {}) {
  const url = new URL(pathname, localAgentBaseURL()).toString()
  const nextOptions = { ...options }
  const method = String(nextOptions.method || "GET").toUpperCase()
  if (method === "POST" && nextOptions.payload && typeof nextOptions.payload === "object" && !Array.isArray(nextOptions.payload)) {
    nextOptions.payload = withClientContext(nextOptions.payload)
  }
  const startedAt = Date.now()
  const derivedArguments =
    options.toolEvent && options.toolEvent.tool_arguments && typeof options.toolEvent.tool_arguments === "object" && !Array.isArray(options.toolEvent.tool_arguments)
      ? options.toolEvent.tool_arguments
      : (method === "POST"
        ? (
          nextOptions.payload &&
          typeof nextOptions.payload === "object" &&
          !Array.isArray(nextOptions.payload) &&
          nextOptions.payload.arguments &&
          typeof nextOptions.payload.arguments === "object" &&
          !Array.isArray(nextOptions.payload.arguments)
            ? nextOptions.payload.arguments
            : nextOptions.payload
        )
        : {})
  try {
    const response = await requestJSON(url, nextOptions)
    if (
      pathname !== "/v1/tool-events/submit" &&
      response &&
      typeof response === "object" &&
      !Array.isArray(response) &&
      (response.ok === false || response.tool_error === true)
    ) {
      await bestEffortSubmitToolEvent({
        event_stage: "plugin_response",
        transport: asString(options.toolEvent?.transport) || "opencode_local_http",
        tool_name: asString(options.toolEvent?.tool_name) || pathname,
        tool_arguments: derivedArguments,
        request_context:
          nextOptions.payload &&
          typeof nextOptions.payload === "object" &&
          !Array.isArray(nextOptions.payload) &&
          nextOptions.payload.request_context &&
          typeof nextOptions.payload.request_context === "object"
            ? nextOptions.payload.request_context
            : options.toolEvent?.request_context,
        duration_ms: Date.now() - startedAt,
        ok: false,
        retryable: response.retryable === true,
        error_code: asString(response.error_code) || "agent_reported_failure",
        error_message: asString(response.error_message || response.error || ""),
        summary_for_user: asString(response.summary_for_user || response.summary || ""),
        stdout_excerpt: asString(response.stdout_excerpt || ""),
        stderr_excerpt: asString(response.stderr_excerpt || ""),
        board_id: asString(response.board_id),
        variant_id: asString(response.variant_id),
        capability_id: asString(response.capability_id),
        device_id: asString(response.device_id),
        metadata: {
          pathname,
          method,
          source_client: "opencode_plugin",
        },
      })
    }
    return response
  } catch (error) {
    if (pathname !== "/v1/tool-events/submit") {
      const classified = classifyToolError(error)
      await bestEffortSubmitToolEvent({
        event_stage: "plugin_transport",
        transport: asString(options.toolEvent?.transport) || "opencode_local_http",
        tool_name: asString(options.toolEvent?.tool_name) || pathname,
        tool_arguments: derivedArguments,
        request_context:
          nextOptions.payload &&
          typeof nextOptions.payload === "object" &&
          !Array.isArray(nextOptions.payload) &&
          nextOptions.payload.request_context &&
          typeof nextOptions.payload.request_context === "object"
            ? nextOptions.payload.request_context
            : options.toolEvent?.request_context,
        duration_ms: Date.now() - startedAt,
        ok: false,
        retryable: classified.retryable === true,
        error_code: classified.code,
        error_message: asString(error?.message || String(error || "")),
        metadata: {
          pathname,
          method,
          source_client: "opencode_plugin",
        },
      })
    }
    throw error
  }
}

async function tryLocalAgentJSON(pathname, options = {}) {
  try {
    return await localAgentJSON(pathname, options)
  } catch {
    return null
  }
}

async function localAgentTool(toolName, args = {}, options = {}) {
  return localAgentJSON("/v1/tools/execute", {
    method: "POST",
    payload: {
      tool_name: toolName,
      arguments: args,
    },
    timeoutMs: options.timeoutMs || 8000,
    toolEvent: {
      tool_name: toolName,
      tool_arguments: args,
      transport: "opencode_local_api_tool_execute",
    },
  })
}

function isToolkitRootCandidate(candidate) {
  return (
    existsSync(path.join(candidate, "VERSION")) ||
    existsSync(path.join(candidate, "product_release")) ||
    existsSync(path.join(candidate, "opencode_plugin")) ||
    existsSync(path.join(candidate, "builtin-plugin-seed")) ||
    existsSync(path.join(candidate, "editor_plugins")) ||
    existsSync(path.join(candidate, "rkflashtool-mac"))
  )
}

function resolveToolkitRoot() {
  const candidates = [
    process.env.OPENCODE_DBT_ROOT || "",
    process.env.DBT_TOOLKIT_ROOT || "",
    process.env.OPENCODE_RK356X_TOOLKIT_ROOT || "",
    process.env.RK356X_TOOLKIT_ROOT || "",
    readRuntimeToolkitRoot(),
    defaultStandaloneRuntimeRoot(),
    path.join(homeDir(), "Library", "Application Support", "development-board-toolchain", "runtime"),
    path.join(homeDir(), "Library", "Application Support", "rk356x-mac-toolkit", "runtime"),
    path.resolve(pluginBaseDir(), "..", "development-board-toolchain-runtime"),
    path.join(homeDir(), "rk356x-mac-toolkit"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (isToolkitRootCandidate(candidate)) {
      return candidate
    }
  }

  throw new Error("Development Board Toolchain runtime root not found. Install the shared runtime first, or set OPENCODE_DBT_ROOT.")
}

function resolveUpdateRepository() {
  const runtime = readRuntimeConfig()
  return (
    asString(process.env.DBT_OPENCODE_UPDATE_REPO) ||
    asString(process.env.OPENCODE_DBT_UPDATE_REPO) ||
    asString(runtime.updateRepository) ||
    "https://github.com/kkwell/DBT-Agent-Plugins.git"
  )
}

function resolveUpdateVersionSource() {
  const runtime = readRuntimeConfig()
  return (
    asString(process.env.DBT_OPENCODE_UPDATE_VERSION_URL) ||
    asString(process.env.OPENCODE_DBT_UPDATE_VERSION_URL) ||
    asString(runtime.updateVersionURL) ||
    "https://raw.githubusercontent.com/kkwell/DBT-Agent-Plugins/main/VERSION"
  )
}

function readPackageVersion(packageRoot) {
  try {
    const packagePath = path.join(packageRoot, "package.json")
    if (!existsSync(packagePath)) return ""
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"))
    return asString(parsed?.version)
  } catch {
    return ""
  }
}

function readLocalPluginVersion() {
  return readPackageVersion(pluginBaseDir())
}

function readLocalUpdateVersion(toolkitRoot) {
  return readLocalPluginVersion() || readLocalToolkitVersion(toolkitRoot)
}

function isDirectoryPath(targetPath) {
  try {
    return statSync(path.resolve(asString(targetPath))).isDirectory()
  } catch {
    return false
  }
}

function localUpdateSourcesAllowed() {
  return boolValue(process.env.DBT_OPENCODE_ALLOW_LOCAL_UPDATE_SOURCE) ||
    boolValue(process.env.OPENCODE_DBT_ALLOW_LOCAL_UPDATE_SOURCE)
}

function isLocalFilesystemSource(source) {
  const text = asString(source)
  if (!text || isHttpURL(text)) return false
  if (text.startsWith("file://")) return true
  if (path.isAbsolute(text)) return true
  if (text.startsWith("./") || text.startsWith("../")) return true
  return existsSync(text)
}

function assertUpdateSourceAllowed(source, label) {
  if (!isLocalFilesystemSource(source) || localUpdateSourcesAllowed()) return
  throw new Error(
    `${label} must be an HTTP(S) release manifest or repository URL in installed OpenCode mode. Local filesystem update sources are disabled so the plugin does not execute development-tree scripts.`
  )
}

function isLikelyRepositorySource(source) {
  const text = asString(source)
  if (!text) return false
  if (existsSync(text)) return isDirectoryPath(text)
  if (/\.git(?:[#?].*)?$/i.test(text)) return true
  if (!isHttpURL(text)) return false
  if (/\.json(?:[#?].*)?$/i.test(text)) return false
  if (/manifest/i.test(text)) return false
  if (/\/releases\/latest\/download\//i.test(text)) return false
  return true
}

function buildPluginUpdateState({
  toolkitRoot,
  localVersion,
  remoteVersion,
  message,
  updateAvailable,
  manifestSource,
  versionSource,
  repositorySource,
  manifestError,
}) {
  return {
    ...readUpdateState(),
    checking: false,
    last_checked_at: isoNow(),
    update_source: "",
    local_version: asString(localVersion) || "unknown",
    remote_version: asString(remoteVersion),
    update_available: updateAvailable === true,
    message: asString(message) || "Update check completed",
    toolkit_root: toolkitRoot,
    update_manifest_url: asString(manifestSource),
    update_version_url: asString(versionSource),
    update_repository: asString(repositorySource),
    manifest_unavailable: Boolean(manifestError),
    manifest_error: asString(manifestError),
  }
}

async function checkPluginUpdateNow(toolkitRoot) {
  const installRoot = inferInstallRoot(toolkitRoot)
  const manifestSource = resolveUpdateManifestSource()
  const versionSource = resolveUpdateVersionSource()
  const repositorySource = resolveUpdateRepository()
  const localVersion = readLocalUpdateVersion(installRoot)

  let manifestError = ""
  if (manifestSource) {
    try {
      const manifest = await requestJSON(manifestSource, { timeoutMs: 4000 })
      const remoteVersion = asString(manifest?.version)
      if (remoteVersion) {
        const nextState = buildPluginUpdateState({
          toolkitRoot: installRoot,
          localVersion,
          remoteVersion,
          updateAvailable: remoteVersion !== localVersion,
          manifestSource,
          versionSource,
          repositorySource,
          message:
            remoteVersion !== localVersion
              ? `Development Board Toolchain update available: ${localVersion} -> ${remoteVersion}`
              : `Development Board Toolchain is up to date: ${localVersion}`,
        })
        writeUpdateState(nextState)
        return nextState
      }
      manifestError = `manifest missing version: ${manifestSource}`
    } catch (error) {
      manifestError = String(error?.message || error || "").trim()
    }
  }

  let remoteVersion = ""
  try {
    remoteVersion = asString(await requestText(versionSource, { timeoutMs: 4000 }))
  } catch {
    remoteVersion = ""
  }

  const nextState = buildPluginUpdateState({
    toolkitRoot: installRoot,
    localVersion,
    remoteVersion,
    updateAvailable: Boolean(remoteVersion && remoteVersion !== localVersion),
    manifestSource,
    versionSource,
    repositorySource,
    manifestError,
    message: remoteVersion
      ? (remoteVersion !== localVersion
        ? `Development Board Toolchain update available: ${localVersion} -> ${remoteVersion}`
        : `Development Board Toolchain is up to date: ${localVersion}`)
      : (manifestError
        ? `Update check completed, release manifest unavailable: ${manifestError}`
        : "Update check completed, remote version unavailable"),
  })
  writeUpdateState(nextState)
  return nextState
}

function manifestBaseDirectory(source) {
  const text = asString(source)
  if (!text) return ""
  if (isHttpURL(text)) {
    const url = new URL(text)
    const pathname = url.pathname.replace(/[^/]+$/, "")
    url.pathname = pathname.endsWith("/") ? pathname : `${pathname}/`
    url.search = ""
    url.hash = ""
    return url.toString()
  }
  return path.dirname(path.resolve(text))
}

function resolveManifestReference(source, value) {
  const text = asString(value)
  if (!text) return ""
  if (isHttpURL(text) || path.isAbsolute(text)) return text
  const base = manifestBaseDirectory(source)
  if (!base) return text
  if (isHttpURL(base)) {
    return new URL(text, base).toString()
  }
  return path.resolve(base, text)
}

async function materializeTextResource(source, targetPath) {
  if (!isHttpURL(source)) {
    const resolved = path.resolve(asString(source))
    if (!existsSync(resolved)) {
      throw new Error(`resource not found: ${resolved}`)
    }
    writeFileSync(targetPath, readFileSync(resolved, "utf8"), "utf8")
    return targetPath
  }

  const url = new URL(source)
  const transport = url.protocol === "https:" ? https : http
  await new Promise((resolve, reject) => {
    const req = transport.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const redirectURL = new URL(res.headers.location, url).toString()
        materializeTextResource(redirectURL, targetPath).then(() => resolve()).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: failed to download ${source}`))
        return
      }
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => {
        data += chunk
      })
      res.on("end", () => {
        writeFileSync(targetPath, data, "utf8")
        resolve()
      })
    })
    req.on("error", reject)
    req.setTimeout(30000, () => {
      req.destroy(new Error(`request timeout after 30000ms`))
    })
  })
  return targetPath
}

function readLocalToolkitVersion(toolkitRoot) {
  try {
    const versionPath = path.join(toolkitRoot, "VERSION")
    if (!existsSync(versionPath)) return "unknown"
    const value = readFileSync(versionPath, "utf8").trim()
    return value || "unknown"
  } catch {
    return "unknown"
  }
}

function inferInstallRoot(toolkitRoot) {
  const normalized = path.resolve(toolkitRoot)
  const appMarker = `${path.sep}Contents${path.sep}Resources${path.sep}toolkit-runtime`
  if (normalized.endsWith(appMarker)) {
    return defaultStandaloneRuntimeRoot()
  }
  const legacyPluginRuntimeMarker = `${path.sep}.config${path.sep}opencode${path.sep}plugins${path.sep}development-board-toolchain${path.sep}runtime`
  const moduleRuntimeMarker = `${path.sep}.config${path.sep}opencode${path.sep}node_modules${path.sep}dbt-agent${path.sep}runtime`
  const packageCacheRuntimeMarker = `${path.sep}.cache${path.sep}opencode${path.sep}packages${path.sep}dbt-agent@latest${path.sep}node_modules${path.sep}dbt-agent${path.sep}runtime`
  if (normalized.endsWith(legacyPluginRuntimeMarker) || normalized.endsWith(moduleRuntimeMarker) || normalized.endsWith(packageCacheRuntimeMarker)) {
    return defaultStandaloneRuntimeRoot()
  }
  return normalized
}

function isHttpURL(value) {
  return /^https?:\/\//i.test(asString(value))
}

function maybeStartBackgroundUpdateCheck(toolkitRoot) {
  const state = readUpdateState()
  const now = Date.now()
  const lastCheckedAt = Date.parse(asString(state.last_checked_at) || "") || 0
  const lastStartedAt = Date.parse(asString(state.last_started_at) || "") || 0
  if (now - lastCheckedAt < 24 * 60 * 60 * 1000) return
  if (now - lastStartedAt < 10 * 60 * 1000) return

  const nextState = {
    ...state,
    last_started_at: isoNow(),
    checking: true,
    toolkit_root: toolkitRoot,
  }
  writeUpdateState(nextState)

const worker = `
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const statePath = ${JSON.stringify(updateStatePath())};
const toolkitRoot = ${JSON.stringify(toolkitRoot)};
const pluginRoot = ${JSON.stringify(pluginBaseDir())};
const manifestSource = ${JSON.stringify(resolveUpdateManifestSource())};
const versionSource = ${JSON.stringify(resolveUpdateVersionSource())};

function readState() {
  try {
    if (!fs.existsSync(statePath)) return {};
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(nextState) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\\n", "utf8");
  } catch {}
}

function readLocalVersion(root) {
  try {
    const packagePath = path.join(pluginRoot, "package.json");
    if (fs.existsSync(packagePath)) {
      const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      const version = typeof parsed?.version === "string" ? parsed.version.trim() : "";
      if (version) return version;
    }
  } catch {}
  try {
    const target = path.join(root, "VERSION");
    if (!fs.existsSync(target)) return "unknown";
    const value = fs.readFileSync(target, "utf8").trim();
    return value || "unknown";
  } catch {
    return "unknown";
  }
}

function finish(extra) {
  const current = readState();
  writeState({
    ...current,
    ...extra,
    checking: false,
    last_checked_at: new Date().toISOString(),
  });
}

function fetchRemoteVersion(url) {
  return new Promise((resolve) => {
    if (!/^https?:\\/\\//i.test(url)) {
      try {
        if (fs.existsSync(url)) {
          const value = fs.readFileSync(url, "utf8").trim();
          resolve(value || null);
          return;
        }
      } catch {}
      resolve(null);
      return;
    }

    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        const value = String(data || "").trim();
        resolve(value || null);
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function fetchRemoteManifest(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    if (!/^https?:\\/\\//i.test(url)) {
      try {
        if (fs.existsSync(url)) {
          const parsed = JSON.parse(fs.readFileSync(url, "utf8"));
          resolve(parsed && typeof parsed === "object" ? parsed : null);
          return;
        }
      } catch {}
      resolve(null);
      return;
    }

    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(String(data || "").trim() || "{}");
          resolve(parsed && typeof parsed === "object" ? parsed : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

const localVersion = readLocalVersion(toolkitRoot);
fetchRemoteManifest(manifestSource).then((manifest) => {
  if (manifest && typeof manifest.version === "string" && manifest.version.trim()) {
    const remoteVersion = manifest.version.trim();
    const updateAvailable = remoteVersion !== localVersion;
    finish({
      local_version: localVersion,
      remote_version: remoteVersion,
      update_available: updateAvailable,
      update_manifest_url: manifestSource,
      message: updateAvailable
        ? \`Development Board Toolchain update available: \${localVersion} -> \${remoteVersion}\`
        : \`Development Board Toolchain is up to date: \${localVersion}\`,
    });
    return;
  }

  return fetchRemoteVersion(versionSource).then((remoteVersion) => {
    const updateAvailable = Boolean(remoteVersion && remoteVersion !== localVersion);
    finish({
      local_version: localVersion,
      remote_version: remoteVersion || "",
      update_available: updateAvailable,
      update_manifest_url: manifestSource,
      message: updateAvailable
        ? \`Development Board Toolchain update available: \${localVersion} -> \${remoteVersion}\`
        : (remoteVersion ? \`Development Board Toolchain is up to date: \${localVersion}\` : "Update check completed, remote version unavailable"),
    });
  });
}).catch(() => {
  finish({
    local_version: localVersion,
    remote_version: "",
    update_available: false,
    update_manifest_url: manifestSource,
    message: "Update check failed",
  });
});
`

  const child = spawn(process.execPath, ["--input-type=module", "-e", worker], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  })
  child.unref()
}

function appendCachedUpdateNotice(payload, toolkitRoot) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const state = readUpdateState()
  const installRoot = inferInstallRoot(toolkitRoot)
  const message = asString(state.message)
  if (state.update_available === true && message) {
    payload._NOTICE_UPDATE_AVAILABLE = `${message}。如果你希望我现在更新插件，请直接说“更新插件”。`
    payload._UPDATE_ACTION_HINT = "Use dbt_update_plugin to update the standalone runtime and OpenCode plugin."
    payload._UPDATE_INSTALL_ROOT = installRoot
  }
  if (state.checking === true) {
    payload._UPDATE_CHECK_STATUS = "background-check-running"
  }
  return payload
}

function asString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeBoardID(value) {
  const raw = asString(value)
  if (!raw) return ""
  const lowered = raw.toLowerCase()
  if (["raspberry pi pico 2 w", "raspberrypipico2w", "pico2w", "pico 2 w", "pico2_w"].includes(lowered)) {
    return "RaspberryPiPico2W"
  }
  if (["coloreasypico2", "color easy pico2"].includes(lowered)) {
    return "ColorEasyPICO2"
  }
  if (["raspberry pi pico 2", "pico2", "pico 2", "rp2350", "rp2350a"].includes(lowered)) {
    return "RP2350"
  }
  if (["taishanpi", "tai shan pi"].includes(lowered)) {
    return "TaishanPi"
  }
  return raw
}

function normalizeVariantID(board, value) {
  const raw = asString(value)
  if (!raw) return ""
  const lowered = raw.toLowerCase()
  if (board === "RaspberryPiPico2W") {
    if (["raspberry pi pico 2 w", "raspberrypipico2w", "pico2w", "pico 2 w", "pico2_w"].includes(lowered)) {
      return "RaspberryPiPico2W"
    }
  }
  if (board === "ColorEasyPICO2") {
    if (["coloreasypico2", "color easy pico2"].includes(lowered)) {
      return "ColorEasyPICO2"
    }
  }
  if (board === "RP2350") {
    if (["raspberry pi pico 2", "rp2350", "rp2350a", "pico2", "pico 2"].includes(lowered)) {
      return "RP2350"
    }
  }
  if (board === "TaishanPi") {
    if (["1m-rk3566", "1m rk3566", "rk3566", "rk3566-tspi-v10"].includes(lowered)) {
      return "1M-RK3566"
    }
  }
  return raw
}

function isRP2350FamilyBoard(board) {
  return ["RP2350", "ColorEasyPICO2", "RaspberryPiPico2W"].includes(asString(board))
}

function normalizeBoardVariantInput(explicitBoard, explicitVariant) {
  let variant = asString(explicitVariant)
  const board = asString(explicitBoard)
  if (!board) return { board, variant }

  const slashMatch = board.match(/^([^/]+?)\s*\/\s*(.+)$/)
  if (slashMatch) {
    const normalizedBoard = normalizeBoardID(slashMatch[1])
    return {
      board: normalizedBoard,
      variant: normalizeVariantID(normalizedBoard, variant || asString(slashMatch[2])),
    }
  }

  const normalizedBoard = normalizeBoardID(board)
  if (normalizedBoard && normalizedBoard !== board) {
    return { board: normalizedBoard, variant: normalizeVariantID(normalizedBoard, variant) }
  }
  if (variant) return { board: normalizedBoard, variant: normalizeVariantID(normalizedBoard, variant) }

  const parts = board.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const splitBoard = normalizeBoardID(parts[0])
    return {
      board: splitBoard,
      variant: normalizeVariantID(splitBoard, parts.slice(1).join(" ")),
    }
  }

  return { board: normalizedBoard, variant: normalizeVariantID(normalizedBoard, "") }
}

function optionalArg(flag, value) {
  const text = asString(value)
  return text ? [flag, text] : []
}

function boolArg(flag, value) {
  const text = String(value ?? "").trim().toLowerCase()
  return text === "1" || text === "true" || text === "yes" || value === true ? [flag] : []
}

function boolValue(value) {
  const text = String(value ?? "").trim().toLowerCase()
  return text === "1" || text === "true" || text === "yes" || value === true
}

function normalizeUserDBTText(text) {
  const raw = String(text ?? "")
  const trimmed = raw.trim()
  if (!trimmed) return raw

  const lowered = trimmed.toLowerCase()
  if (
    lowered === "当前开发板状态" ||
    lowered === "开发板状态" ||
    lowered === "当前板卡状态" ||
    lowered === "查看当前开发板状态" ||
    lowered.includes("current board status")
  ) {
    return "Call the exact DBT alias tool dbtstatus with request \"current board status\". Then summarize the result."
  }
  if (
    (trimmed.includes("初始化镜像") || trimmed.includes("出厂镜像") || trimmed.includes("factory")) &&
    (trimmed.includes("烧录") || trimmed.includes("刷写") || trimmed.includes("flash"))
  ) {
    const dryRun = trimmed.includes("dry") || trimmed.includes("验证") || trimmed.includes("不真实") || trimmed.includes("不要真实")
    const args = {
      image_source: "factory",
      scope: "all",
      ...(dryRun ? { dry_run: "true" } : {}),
    }
    if (dryRun) {
      return `Call the exact DBT alias tool dbtflashimage with request "TaishanPi factory image flashing dry run" and arguments_json ${JSON.stringify(args)}. Then summarize the result.`
    }
    return `Call the exact DBT alias tool dbtflashstart with request "Start TaishanPi factory image flashing" and arguments_json ${JSON.stringify(args)}. Then call the exact DBT alias tool dbtjobstatus with the returned job_id and summarize current progress.`
  }
  if (lowered === "cpu频率是多少" || lowered === "cpu频率") {
    return "Call the exact DBT alias tool dbtcpufrequency with request \"current CPU frequency\". Then summarize the result."
  }
  if (lowered === "ddr频率是多少" || lowered === "ddr频率") {
    return "Call the exact DBT alias tool dbtddrfrequency with request \"current DDR frequency\". Then summarize the result."
  }
  if (lowered === "cpu温度是多少" || lowered === "cpu温度") {
    return "Call the exact DBT alias tool dbtcputemperature with request \"current CPU temperature\". Then summarize the result."
  }
  if (trimmed.includes("wifi") || trimmed.includes("WiFi") || trimmed.includes("无线")) {
    if (trimmed.includes("扫描") || trimmed.includes("scan")) {
      return "Call the exact DBT alias tool dbtwirelessprobe with request \"WiFi scan\" and arguments_json {\"target\":\"wifi_scan\"}. Then summarize the result."
    }
    if (trimmed.includes("状态") || trimmed.includes("模块") || trimmed.includes("status")) {
      return "Call the exact DBT alias tool dbtwirelessprobe with request \"WiFi status\" and arguments_json {\"target\":\"wifi_status\"}. Then summarize the result."
    }
  }
  if (trimmed.includes("蓝牙") || lowered.includes("bluetooth")) {
    if (trimmed.includes("扫描") || trimmed.includes("scan")) {
      return "Call the exact DBT alias tool dbtbluetoothscan with request \"Bluetooth scan\". Then summarize the result."
    }
    if (trimmed.includes("状态") || trimmed.includes("模块") || trimmed.includes("status")) {
      return "Call the exact DBT alias tool dbtwirelessprobe with request \"Bluetooth status\" and arguments_json {\"target\":\"bluetooth_status\"}. Then summarize the result."
    }
  }

  return trimmed
    .replace(/\bcpu\b/gi, "CPU")
    .replace(/\bddr\b/gi, "DDR")
    .replace(/\brtc\b/gi, "RTC")
    .replace(/\bgpio\b/gi, "GPIO")
    .replace(/\buart\b/gi, "UART")
    .replace(/\bi2c\b/gi, "I2C")
    .replace(/\bspi\b/gi, "SPI")
    .replace(/\bwifi\b/gi, "WiFi")
}

function jsonText(obj) {
  return JSON.stringify(obj, null, 2)
}

function sanitizeArtifactBaseName(value) {
  const raw = asString(value) || "dbt_generated_program"
  const sanitized = raw
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return sanitized || "dbt_generated_program"
}

function resolveWorkspacePath(value) {
  const text = asString(value)
  if (!text) return ""
  return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text)
}

function normalizeCapabilityAlias(value) {
  const raw = asString(value)
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "")
  const aliasMap = new Map([
    ["ledcontrol", "rgb_led"],
    ["rgbled", "rgb_led"],
    ["tricolorled", "rgb_led"],
    ["threecolorled", "rgb_led"],
    ["trafficlight", "rgb_led"],
    ["gpiocontrol", "gpio"],
    ["wifibluetooth", "wifi_bluetooth"],
    ["wifiandbluetooth", "wifi_bluetooth"],
    ["sdcard", "microsd_storage"],
    ["tfcard", "microsd_storage"],
    ["camera", "camera_display"],
    ["cameradisplay", "camera_display"],
    ["40pin", "pin_header_40pin"],
    ["pinheader", "pin_header_40pin"],
  ])
  return aliasMap.get(key) || raw
}

function normalizeCStringLiteralNewlines(source, language) {
  const normalized = String(language || "c").trim().toLowerCase()
  if (!["c", "c++", "cpp", "cxx"].includes(normalized)) return String(source || "")
  const input = String(source || "")
  let out = ""
  let inString = false
  let inChar = false
  let inLineComment = false
  let inBlockComment = false
  let escaped = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1] || ""

    if (inLineComment) {
      out += ch
      if (ch === "\n") inLineComment = false
      continue
    }

    if (inBlockComment) {
      out += ch
      if (ch === "*" && next === "/") {
        out += "/"
        i += 1
        inBlockComment = false
      }
      continue
    }

    if (!inString && !inChar && ch === "/" && next === "/") {
      out += "//"
      i += 1
      inLineComment = true
      continue
    }

    if (!inString && !inChar && ch === "/" && next === "*") {
      out += "/*"
      i += 1
      inBlockComment = true
      continue
    }

    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === "\\") {
        out += ch
        escaped = true
        continue
      }
      if (ch === "\"") {
        out += ch
        inString = false
        continue
      }
      if (ch === "\n") {
        out += "\\n"
        continue
      }
      out += ch
      continue
    }

    if (inChar) {
      out += ch
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === "'") inChar = false
      continue
    }

    if (ch === "\"") {
      out += ch
      inString = true
      continue
    }
    if (ch === "'") {
      out += ch
      inChar = true
      continue
    }

    out += ch
  }

  return out
}

function excerptText(value, maxChars = 1200) {
  const text = String(value || "").trim()
  if (!text) return ""
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
}

function summarizeBuildRunPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const summary = {
    ok: payload.ok === true,
    board_id: asString(payload.board_id),
    variant_id: asString(payload.variant_id),
    capability_id: asString(payload.capability_id),
    binary_name: asString(payload.binary_name),
    local_source_file: asString(payload.local_source_file),
    local_binary_file: asString(payload.local_binary_file),
    remote_workdir: asString(payload.remote_workdir),
    summary: asString(payload.summary),
    returncode: Number.isFinite(payload.returncode) ? payload.returncode : undefined,
  }
  if (summary.ok) {
    return summary
  }
  const stderr = excerptText(payload.stderr || payload.output || "")
  const stdout = excerptText(payload.stdout || "")
  let errorType = "runtime_action_failed"
  if (/undefined reference|error:|ld returned/i.test(stderr)) {
    errorType = "compile_failed"
  }
  return {
    ...summary,
    error_type: errorType,
    stderr_excerpt: stderr,
    stdout_excerpt: stdout,
    summary:
      summary.summary ||
      (stderr ? "program build or deployment failed; inspect stderr_excerpt" : "program build or deployment failed"),
  }
}

function summarizeCapabilitySummariesPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const summaries = Array.isArray(payload.capability_summaries) ? payload.capability_summaries : []
  return {
    ok: true,
    board_id: asString(payload.board_id),
    variant_id: asString(payload.variant_id),
    count: summaries.length,
    selection_rule:
      asString(payload.selection_rule) ||
      "Choose the best matching capability from these summaries, then fetch full context only for the chosen capability.",
    capability_summaries: summaries.map((item) => ({
      capability_id: asString(item.capability_id),
      summary: asString(item.summary),
      purpose: asString(item.purpose),
      default_delivery: asString(item.default_delivery),
      intent_mapping: Array.isArray(item.intent_mapping) ? item.intent_mapping.slice(0, 8) : [],
      execution_policy: item.execution_policy && typeof item.execution_policy === "object"
        ? {
            default_delivery: asString(item.execution_policy.default_delivery),
            ask_before_code_generation: item.execution_policy.ask_before_code_generation === true,
            upgrade_to_code_when: Array.isArray(item.execution_policy.upgrade_to_code_when)
              ? item.execution_policy.upgrade_to_code_when.slice(0, 6)
              : [],
            prefer_direct_shell_when: Array.isArray(item.execution_policy.prefer_direct_shell_when)
              ? item.execution_policy.prefer_direct_shell_when.slice(0, 6)
              : [],
          }
        : undefined,
    })),
  }
}

function summarizeCapabilityContextPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const implementation = payload.implementation_contract && typeof payload.implementation_contract === "object"
    ? payload.implementation_contract
    : {}
  const executionAvailability = payload.execution_availability && typeof payload.execution_availability === "object"
    ? payload.execution_availability
    : {}
  const capabilityID = asString(payload.capability_id)
  const buildContract = implementation.build_contract && typeof implementation.build_contract === "object"
    ? implementation.build_contract
    : {}
  const compactFeatureProfiles = (profiles) => {
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return undefined
    const entries = Object.entries(profiles)
    const next = {}
    for (const [name, value] of entries) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      next[name] = {
        required_headers: Array.isArray(value.required_headers) ? value.required_headers.slice(0, 16) : undefined,
        required_include_directories: Array.isArray(value.required_include_directories) ? value.required_include_directories.slice(0, 20) : undefined,
        required_link_libraries: Array.isArray(value.required_link_libraries) ? value.required_link_libraries.slice(0, 16) : undefined,
        required_compile_definitions: Array.isArray(value.required_compile_definitions) ? value.required_compile_definitions.slice(0, 16) : undefined,
        generated_support_headers: Array.isArray(value.generated_support_headers) ? value.generated_support_headers.slice(0, 8) : undefined,
        notes: Array.isArray(value.notes) ? value.notes.slice(0, 6) : undefined,
      }
    }
    return Object.keys(next).length ? next : undefined
  }
  const capabilityProfiles = buildContract.capability_build_profiles && typeof buildContract.capability_build_profiles === "object"
    ? buildContract.capability_build_profiles
    : {}
  const selectedCapabilityProfile = capabilityID && capabilityProfiles[capabilityID] && typeof capabilityProfiles[capabilityID] === "object"
    ? capabilityProfiles[capabilityID]
    : undefined
  const compactSelectedCapabilityProfile = selectedCapabilityProfile
    ? {
        required_headers: Array.isArray(selectedCapabilityProfile.required_headers) ? selectedCapabilityProfile.required_headers.slice(0, 16) : undefined,
        required_include_directories: Array.isArray(selectedCapabilityProfile.required_include_directories) ? selectedCapabilityProfile.required_include_directories.slice(0, 20) : undefined,
        required_link_libraries: Array.isArray(selectedCapabilityProfile.required_link_libraries) ? selectedCapabilityProfile.required_link_libraries.slice(0, 16) : undefined,
        required_compile_definitions: Array.isArray(selectedCapabilityProfile.required_compile_definitions) ? selectedCapabilityProfile.required_compile_definitions.slice(0, 16) : undefined,
        generated_support_headers: Array.isArray(selectedCapabilityProfile.generated_support_headers) ? selectedCapabilityProfile.generated_support_headers.slice(0, 8) : undefined,
        feature_build_profiles: compactFeatureProfiles(selectedCapabilityProfile.feature_build_profiles),
        notes: Array.isArray(selectedCapabilityProfile.notes) ? selectedCapabilityProfile.notes.slice(0, 6) : undefined,
      }
    : undefined
  const compactTopLevelFeatureProfiles = compactFeatureProfiles(buildContract.feature_build_profiles)
  return {
    board_id: asString(payload.board_id),
    variant_id: asString(payload.variant_id),
    capability_id: capabilityID,
    state: asString(payload.state),
    summary: asString(payload.knowledge_digest?.summary || payload.summary),
    purpose: asString(payload.knowledge_digest?.purpose),
    intent_mapping: Array.isArray(payload.knowledge_digest?.intent_mapping)
      ? payload.knowledge_digest.intent_mapping.slice(0, 10)
      : [],
    execution_availability: {
      connected_device: executionAvailability.connected_device === true,
      connected_board_matches_request: executionAvailability.connected_board_matches_request === true,
      live_control_available: executionAvailability.live_control_available === true,
      note: asString(executionAvailability.note),
    },
    operator_warning: asString(payload.operator_warning),
    implementation_contract: {
      board_runtime_model: asString(implementation.board_runtime_model),
      control_backend: asString(implementation.control_backend),
      source_must_be_self_contained: implementation.source_must_be_self_contained === true,
      must_not_invent_helper_apis: implementation.must_not_invent_helper_apis === true,
      linked_sdk_api_available: implementation.linked_sdk_api_available === true,
      preferred_program_shape: asString(implementation.preferred_program_shape),
      supported_runtime_actions: Array.isArray(implementation.supported_runtime_actions)
        ? implementation.supported_runtime_actions.slice(0, 8)
        : [],
      runtime_policy_contract:
        implementation.runtime_policy_contract && typeof implementation.runtime_policy_contract === "object"
          ? implementation.runtime_policy_contract
          : undefined,
      build_contract:
        buildContract && typeof buildContract === "object"
          ? {
              project_shape: asString(buildContract.project_shape),
              pico_board: asString(buildContract.pico_board),
              compile_profile: asString(buildContract.compile_profile),
              deploy_transport: asString(buildContract.deploy_transport),
              required_cmake_import: asString(buildContract.required_cmake_import),
              required_project_layout: Array.isArray(buildContract.required_project_layout)
                ? buildContract.required_project_layout.slice(0, 8)
                : [],
              required_cmake_steps: Array.isArray(buildContract.required_cmake_steps)
                ? buildContract.required_cmake_steps.slice(0, 12)
                : [],
              required_compile_definitions: Array.isArray(buildContract.required_compile_definitions)
                ? buildContract.required_compile_definitions.slice(0, 16)
                : [],
              required_headers: Array.isArray(buildContract.required_headers)
                ? buildContract.required_headers.slice(0, 16)
                : [],
              required_include_directories: Array.isArray(buildContract.required_include_directories)
                ? buildContract.required_include_directories.slice(0, 20)
                : [],
              required_link_libraries: Array.isArray(buildContract.required_link_libraries)
                ? buildContract.required_link_libraries.slice(0, 16)
                : [],
              generated_support_headers: Array.isArray(buildContract.generated_support_headers)
                ? buildContract.generated_support_headers.slice(0, 8)
                : [],
              generation_rules: Array.isArray(buildContract.generation_rules)
                ? buildContract.generation_rules.slice(0, 6)
                : [],
              must_not_do: Array.isArray(buildContract.must_not_do)
                ? buildContract.must_not_do.slice(0, 8)
                : [],
              board_specific_led_rules: Array.isArray(buildContract.board_specific_led_rules)
                ? buildContract.board_specific_led_rules.slice(0, 6)
                : [],
              selected_capability_profile: compactSelectedCapabilityProfile,
              feature_build_profiles: compactTopLevelFeatureProfiles,
            }
          : undefined,
    },
    tooling_requirements:
      payload.tooling_requirements && typeof payload.tooling_requirements === "object"
        ? {
            deploy_transport: asString(payload.tooling_requirements.deploy_transport),
            runtime_profiles: Array.isArray(payload.tooling_requirements.runtime_profiles)
              ? payload.tooling_requirements.runtime_profiles.slice(0, 8)
              : [],
          }
        : undefined,
    verification: Array.isArray(payload.knowledge_digest?.verification)
      ? payload.knowledge_digest.verification.slice(0, 8)
      : [],
    knowledge_ref_count: Array.isArray(payload.knowledge_refs) ? payload.knowledge_refs.length : 0,
    response_rules: Array.isArray(payload.response_rules) ? payload.response_rules.slice(0, 4) : [],
  }
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return ""
}

function detectRP2350BuildRoots() {
  const supportRoot = path.join(homeDir(), "Library", "Application Support", "development-board-toolchain")
  const runtimeRoot = path.join(
    supportRoot,
    "board-environments",
    "RP2350RuntimeCore",
    "minimal_runtime",
    "RP2350",
  )
  const sdkCoreRoot = path.join(
    supportRoot,
    "board-environments",
    "RP2350SDKCore",
    "sdk_core",
    "RP2350",
  )
  const buildOverlayRoot = path.join(
    supportRoot,
    "board-environments",
    "RP2350BuildOverlay",
    "full_build",
    "RP2350",
  )
  const picoSDKPath = path.join(sdkCoreRoot, "pico-sdk")
  const picotoolPath = firstExistingPath([
    path.join(sdkCoreRoot, "picotool", "build", "picotool"),
    path.join(runtimeRoot, "picotool", "build", "picotool"),
  ])
  const pioasmPath = firstExistingPath([
    path.join(picoSDKPath, "tools", "pioasm"),
    path.join(picoSDKPath, "build", "pioasm", "pioasm"),
  ])
  const toolchainBase = path.join(sdkCoreRoot, "toolchains")
  let armNoneEabiGcc = ""
  try {
    for (const entry of readdirSync(toolchainBase)) {
      const candidate = path.join(toolchainBase, entry, "bin", "arm-none-eabi-gcc")
      if (existsSync(candidate)) {
        armNoneEabiGcc = candidate
        break
      }
    }
  } catch {}
  return {
    support_root: supportRoot,
    runtime_root: existsSync(runtimeRoot) ? runtimeRoot : "",
    sdk_core_root: existsSync(sdkCoreRoot) ? sdkCoreRoot : "",
    build_overlay_root: existsSync(buildOverlayRoot) ? buildOverlayRoot : "",
    pico_sdk_path: existsSync(picoSDKPath) ? picoSDKPath : "",
    picotool_path: picotoolPath,
    pioasm_path: pioasmPath,
    arm_none_eabi_gcc: armNoneEabiGcc,
  }
}

function summarizeBoardConfigPayload(payload, resolvedBoard, resolvedVariant) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const manifest = payload.manifest && typeof payload.manifest === "object" ? payload.manifest : {}
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {}
  const environment = payload.environment && typeof payload.environment === "object" ? payload.environment : {}
  const boardID = asString(profile.board_id || manifest.id || resolvedBoard)
  const variantID = asString(payload.resolved_variant || payload.requested_variant || resolvedVariant || boardID)
  const rp2350FamilyBoards = new Set(["RP2350", "ColorEasyPICO2", "RaspberryPiPico2W"])
  const isRP2350Family = rp2350FamilyBoards.has(boardID) || rp2350FamilyBoards.has(variantID)
  const minimalEnvironment = Object.keys(environment).length
    ? {
        ok: environment.ok === true,
        docker_cli: environment.docker_cli === true,
        docker_daemon: environment.docker_daemon === true,
        host_image_dir: environment.host_image_dir === true,
        official_image: environment.official_image === true,
        release_volume: environment.release_volume === true,
        gnu_toolchain: environment.gnu_toolchain && typeof environment.gnu_toolchain === "object"
          ? {
              available: environment.gnu_toolchain.available === true,
              configured: environment.gnu_toolchain.configured === true,
              path: asString(environment.gnu_toolchain.path),
              detail: asString(environment.gnu_toolchain.detail),
            }
          : undefined,
        qt_toolchain: environment.qt_toolchain && typeof environment.qt_toolchain === "object"
          ? {
              available: environment.qt_toolchain.available === true,
              configured: environment.qt_toolchain.configured === true,
              path: asString(environment.qt_toolchain.path),
              detail: asString(environment.qt_toolchain.detail),
            }
          : undefined,
      }
    : undefined
  return {
    ok: payload.ok === true,
    board_id: boardID,
    variant_id: variantID,
    display_name: asString(profile.display_name || manifest.display_name),
    manufacturer: asString(profile.manufacturer || manifest.manufacturer),
    capabilities: Array.isArray(profile.capabilities)
      ? profile.capabilities.slice(0, 12)
      : Array.isArray(manifest.capabilities)
        ? manifest.capabilities.slice(0, 12)
        : [],
    plugin_root: asString(payload.board_root),
    environment: minimalEnvironment,
    runtime_contract: isRP2350Family ? detectRP2350BuildRoots() : undefined,
  }
}

async function waitForAgentJob(jobID, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 60000)
  const pollIntervalMs = Number(options.pollIntervalMs || 500)
  const startedAt = Date.now()
  const toolEvent =
    options.toolEvent && typeof options.toolEvent === "object" && !Array.isArray(options.toolEvent)
      ? options.toolEvent
      : {}
  const toolArguments =
    toolEvent.tool_arguments && typeof toolEvent.tool_arguments === "object" && !Array.isArray(toolEvent.tool_arguments)
      ? {
          ...toolEvent.tool_arguments,
          job_id: jobID,
        }
      : { job_id: jobID }

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await localAgentJSON(`/v1/jobs/${encodeURIComponent(jobID)}`, {
      timeoutMs: Math.min(timeoutMs, 8000),
      toolEvent: {
        tool_name: asString(toolEvent.tool_name) || `job:${jobID}`,
        tool_arguments: toolArguments,
        request_context:
          toolEvent.request_context && typeof toolEvent.request_context === "object"
            ? toolEvent.request_context
            : undefined,
        transport: asString(toolEvent.transport) || "opencode_local_job_poll",
      },
    })
    const job = payload?.job && typeof payload.job === "object" ? payload.job : {}
    const state = asString(job.state || payload?.task?.status)
    if (["finished", "failed", "error", "cancelled"].includes(state)) {
      return payload
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  await bestEffortSubmitToolEvent({
    event_stage: "plugin_timeout",
    transport: asString(toolEvent.transport) || "opencode_local_job_poll",
    tool_name: asString(toolEvent.tool_name) || `job:${jobID}`,
    tool_arguments: toolArguments,
    request_context:
      toolEvent.request_context && typeof toolEvent.request_context === "object"
        ? toolEvent.request_context
        : undefined,
    duration_ms: Date.now() - startedAt,
    ok: false,
    retryable: true,
    error_code: "job_timeout",
    error_message: `timed out waiting for agent job ${jobID}`,
    metadata: {
      job_id: jobID,
      timeout_ms: timeoutMs,
      poll_interval_ms: pollIntervalMs,
      source_client: "opencode_plugin",
    },
  })
  throw new Error(`timed out waiting for agent job ${jobID}`)
}

function summarizeRP2350JobPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const job = payload.job && typeof payload.job === "object" ? payload.job : {}
  const request = job.request && typeof job.request === "object" ? job.request : {}
  const result = job.result && typeof job.result === "object" ? job.result : {}
  const ok = job.ok === true || result.ok === true
  const action = asString(result.action || request.action || job.action).replace(/^rp2350_/, "")
  const summary = asString(result.summary_for_user || job.output_tail || job.failure_summary || result.output || result.error)

  return {
    ok,
    job_id: asString(job.job_id),
    action,
    board_id: asString(result.board_id || request.board_id),
    variant_id: asString(result.variant_id || request.variant_id),
    state: asString(result.state || job.state),
    status_label: asString(job.status_label),
    summary_for_user: summary,
    required_runtime_action: asString(job.required_runtime_action),
    runtime_port:
      result.runtime_port && typeof result.runtime_port === "object"
        ? result.runtime_port
        : undefined,
    bootsel_present: result.bootsel_present === true,
    runtime_resettable: result.runtime_resettable === true,
    uf2_path: asString(request.uf2_path),
    output_path: asString(request.output_path),
    lines: Number.isFinite(request.lines) ? request.lines : undefined,
    follow: request.follow === true,
    returncode: Number.isFinite(job.returncode) ? job.returncode : undefined,
    stdout_excerpt: excerptText(result.stdout || ""),
    stderr_excerpt: excerptText(result.stderr || ""),
  }
}

async function runRP2350Job(action, args = {}, options = {}) {
  const requestContext = defaultClientContext()
  const requestedBoard = normalizeBoardID(args.board_id || args.board) || "RP2350"
  const requestedVariant = normalizeVariantID(requestedBoard, args.variant_id || args.variant)
    || (requestedBoard === "RP2350" ? "" : requestedBoard)
  let sanitizedDeviceID = ""
  try {
    const status = await getStatusWithAutoRepair()
    sanitizedDeviceID = sanitizeExplicitDeviceID(status, args.device_id, requestedBoard, requestedVariant)
  } catch {
    sanitizedDeviceID = ""
  }
  const target = action === "set_board_model"
    ? await resolveConnectedRP2350FamilyTarget(sanitizedDeviceID)
    : await resolveConnectedMutationTarget(
        requestedBoard,
        requestedVariant,
        sanitizedDeviceID,
      )
  const effectiveBoard = action === "set_board_model" ? requestedBoard : (target.board || requestedBoard)
  const effectiveVariant = action === "set_board_model" ? requestedVariant : (target.variant || requestedVariant)
  const payload = {
    action,
    board_id: effectiveBoard,
    variant_id: effectiveVariant,
    request_context: requestContext,
  }
  if (target.device_id) payload.device_id = target.device_id

  const uf2Path = resolveWorkspacePath(args.uf2_path || args.uf2)
  if (uf2Path) payload.uf2_path = uf2Path
  const outputPath = resolveWorkspacePath(args.output_path || args.output)
  if (outputPath) payload.output_path = outputPath
  if (typeof args.allow_runtime_switch !== "undefined") {
    payload.allow_runtime_switch = boolValue(args.allow_runtime_switch)
  }
  if (typeof args.follow !== "undefined") {
    payload.follow = boolValue(args.follow)
  }
  if (typeof args.lines !== "undefined") {
    const parsed = Number(args.lines)
    if (Number.isFinite(parsed) && parsed > 0) payload.lines = Math.floor(parsed)
  }

  const toolName = `dbt_rp2350_${action}`
  const createResult = await localAgentJSON("/v1/jobs/rp2350", {
    method: "POST",
    payload,
    timeoutMs: options.createTimeoutMs || 10000,
    toolEvent: {
      tool_name: toolName,
      tool_arguments: payload,
      request_context: requestContext,
      transport: "opencode_rp2350_job_create",
    },
  })
  const jobID = asString(createResult?.job?.job_id || createResult?.task?.id)
  if (!jobID) {
    await bestEffortSubmitToolEvent({
      event_stage: "plugin_response",
      transport: "opencode_rp2350_job_create",
      tool_name: toolName,
      tool_arguments: payload,
      request_context: requestContext,
      ok: false,
      retryable: false,
      error_code: "job_id_missing",
      error_message: `rp2350 ${action} did not return a job id`,
      summary_for_user: asString(createResult?.summary_for_user || createResult?.summary || ""),
      metadata: {
        source_client: "opencode_plugin",
      },
    })
    throw new Error(`rp2350 ${action} did not return a job id`)
  }
  const finalPayload = await waitForAgentJob(jobID, {
    timeoutMs: options.timeoutMs || 90000,
    pollIntervalMs: options.pollIntervalMs || 500,
    toolEvent: {
      tool_name: toolName,
      tool_arguments: payload,
      request_context: requestContext,
      transport: "opencode_rp2350_job_poll",
    },
  })
  return summarizeRP2350JobPayload(finalPayload)
}

function summarizeFlashImageJobPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const job = payload.job && typeof payload.job === "object" ? payload.job : {}
  const request = job.request && typeof job.request === "object" ? job.request : {}
  const result = job.result && typeof job.result === "object" ? job.result : {}
  const ok = job.ok === true || result.ok === true
  const progress = normalizeJobProgress(result.progress ?? job.progress ?? payload.progress)
  const summary = asString(
    result.summary_for_user ||
      job.output_tail ||
      job.failure_summary ||
      result.output ||
      result.error ||
      payload.summary_for_user
  )

  return {
    ok,
    job_id: asString(job.job_id),
    action: "flash_image",
    board_id: asString(result.board_id || request.board_id),
    variant_id: asString(result.variant_id || request.variant_id),
    device_id: asString(result.device_id || request.device_id),
    state: asString(result.state || job.state),
    status_label: asString(job.status_label),
    progress,
    progress_percent: typeof progress === "number" ? Math.round(progress * 100) : undefined,
    progress_stage: asString(result.progress_stage || job.progress_stage),
    progress_text: asString(result.progress_text || job.progress_text),
    summary_for_user: summary,
    image_source: asString(result.image_source || request.image_source),
    scope: asString(result.scope || request.scope),
    host_image_dir: asString(result.host_image_dir || request.host_image_dir),
    mode: asString(result.mode || request.mode),
    dry_run: result.dry_run === true || request.dry_run === true,
    returncode: Number.isFinite(job.returncode) ? job.returncode : undefined,
    stdout_excerpt: excerptText(result.stdout || job.output_tail || ""),
    stderr_excerpt: excerptText(result.stderr || job.failure_summary || ""),
  }
}

function normalizeJobProgress(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  if (parsed > 1) return Math.max(0, Math.min(1, parsed / 100))
  return Math.max(0, Math.min(1, parsed))
}

function summarizeAgentJobStatusPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const job = payload.job && typeof payload.job === "object" ? payload.job : {}
  const request = job.request && typeof job.request === "object" ? job.request : {}
  const result = job.result && typeof job.result === "object" ? job.result : {}
  const requestPayload =
    options.requestPayload && typeof options.requestPayload === "object" && !Array.isArray(options.requestPayload)
      ? options.requestPayload
      : {}
  const state = asString(result.state || job.state || payload?.task?.status)
  const terminal = ["finished", "failed", "error", "cancelled"].includes(state)
  const failed = ["failed", "error", "cancelled"].includes(state)
  const progress = normalizeJobProgress(result.progress ?? job.progress ?? payload.progress)
  const outputTail = asString(result.output_tail || job.output_tail || payload.output_tail)
  const failureSummary = asString(result.failure_summary || job.failure_summary || payload.failure_summary)
  const summary = asString(
    result.summary_for_user ||
      job.summary_for_user ||
      outputTail ||
      failureSummary ||
      result.output ||
      result.error ||
      payload.summary_for_user ||
      payload.summary
  )

  return {
    ok: failed ? false : payload.ok !== false,
    job_id: asString(job.job_id || payload?.task?.id || options.jobID),
    action: asString(options.action || result.action || request.action || job.action),
    state,
    terminal,
    status_label: asString(job.status_label || result.status_label),
    progress,
    progress_percent: typeof progress === "number" ? Math.round(progress * 100) : undefined,
    progress_stage: asString(result.progress_stage || job.progress_stage),
    progress_text: asString(result.progress_text || job.progress_text),
    summary_for_user: summary,
    output_tail: excerptText(outputTail),
    failure_summary: excerptText(failureSummary),
    required_runtime_action: asString(job.required_runtime_action || result.required_runtime_action),
    board_id: asString(result.board_id || request.board_id || requestPayload.board_id),
    variant_id: asString(result.variant_id || request.variant_id || requestPayload.variant_id),
    device_id: asString(result.device_id || request.device_id || requestPayload.device_id),
    image_source: asString(result.image_source || request.image_source || requestPayload.image_source),
    scope: asString(result.scope || request.scope || requestPayload.scope),
    dry_run: result.dry_run === true || request.dry_run === true || requestPayload.dry_run === true,
    returncode: Number.isFinite(job.returncode) ? job.returncode : undefined,
    poll_hint: terminal
      ? ""
      : "This is a non-blocking agent job. Query dbtjobstatus with this job_id to show current progress.",
  }
}

async function createFlashImageJob(args = {}, options = {}) {
  const requestContext = defaultClientContext()
  const requestedBoard = normalizeBoardID(args.board_id || args.board) || ""
  const requestedVariant = normalizeVariantID(requestedBoard, args.variant_id || args.variant)
  let sanitizedDeviceID = ""
  try {
    const status = await getStatusWithAutoRepair()
    sanitizedDeviceID = sanitizeExplicitDeviceID(status, args.device_id, requestedBoard, requestedVariant)
  } catch {
    sanitizedDeviceID = ""
  }
  const target = await resolveConnectedMutationTarget(
    requestedBoard,
    requestedVariant,
    sanitizedDeviceID || args.device_id,
  )
  const payload = {
    action: "flash_image",
    board_id: target.board || requestedBoard,
    variant_id: target.variant || requestedVariant,
    device_id: target.device_id,
    image_source: asString(args.image_source) || "factory",
    scope: asString(args.scope) || "all",
    request_context: requestContext,
    dry_run: boolValue(args.dry_run),
  }
  const hostImageDir = resolveWorkspacePath(args.host_image_dir)
  if (hostImageDir) payload.host_image_dir = hostImageDir
  const mode = asString(args.mode)
  if (mode) payload.mode = mode

  const createResult = await localAgentJSON("/v1/jobs/flash", {
    method: "POST",
    payload,
    timeoutMs: options.createTimeoutMs || 12000,
    toolEvent: {
      tool_name: asString(options.toolName) || "dbt_flash_image",
      tool_arguments: payload,
      request_context: requestContext,
      transport: asString(options.transport) || "opencode_flash_job_create",
    },
  })
  const jobID = asString(createResult?.job?.job_id || createResult?.task?.id)
  if (!jobID) {
    await bestEffortSubmitToolEvent({
      event_stage: "plugin_response",
      transport: "opencode_flash_job_create",
      tool_name: "dbt_flash_image",
      tool_arguments: payload,
      request_context: requestContext,
      ok: false,
      retryable: false,
      error_code: "job_id_missing",
      error_message: "flash image job did not return a job id",
      summary_for_user: asString(createResult?.summary_for_user || createResult?.summary || ""),
      metadata: {
        source_client: "opencode_plugin",
      },
    })
    throw new Error("flash image job did not return a job id")
  }
  return { createResult, jobID, payload, requestContext }
}

async function startFlashImageJob(args = {}, options = {}) {
  try {
    const created = await createFlashImageJob(args, {
      ...options,
      toolName: asString(options.toolName) || "dbt_start_flash_image",
      transport: asString(options.transport) || "opencode_flash_job_start",
    })
    return summarizeAgentJobStatusPayload(created.createResult, {
      action: "flash_image",
      jobID: created.jobID,
      requestPayload: created.payload,
    })
  } catch (error) {
    const message = asString(error?.message || String(error || ""))
    const noBoard = message.toLowerCase().includes("no connected development board")
    const classified = classifyToolError(error)
    return {
      ok: false,
      action: "flash_image",
      state: "not_started",
      terminal: true,
      error_code: noBoard ? "no_connected_board" : classified.code,
      error_message: excerptText(message),
      summary_for_user: noBoard
        ? "没有检测到已连接的开发板，无法启动烧写任务。请连接开发板后重试。"
        : `启动烧写任务失败：${excerptText(message, 240)}`,
      retryable: true,
    }
  }
}

async function runFlashImageJob(args = {}, options = {}) {
  const created = await createFlashImageJob(args, options)
  const finalPayload = await waitForAgentJob(created.jobID, {
    timeoutMs: options.timeoutMs || (created.payload.dry_run ? 60000 : 900000),
    pollIntervalMs: options.pollIntervalMs || 750,
    toolEvent: {
      tool_name: "dbt_flash_image",
      tool_arguments: created.payload,
      request_context: created.requestContext,
      transport: "opencode_flash_job_poll",
    },
  })
  return summarizeFlashImageJobPayload(finalPayload)
}

async function getAgentJobStatus(jobID, options = {}) {
  const requestContext = defaultClientContext()
  const id = asString(jobID || options.jobID)
  if (!id) {
    return {
      ok: false,
      error_code: "job_id_required",
      error_message: "job_id is required",
      summary_for_user: "需要提供 job_id 才能查询烧写或其他长任务进度。",
    }
  }
  try {
    const payload = await localAgentJSON(`/v1/jobs/${encodeURIComponent(id)}`, {
      timeoutMs: options.timeoutMs || 8000,
      toolEvent: {
        tool_name: asString(options.toolName) || "dbt_get_job_status",
        tool_arguments: { job_id: id },
        request_context: requestContext,
        transport: asString(options.transport) || "opencode_job_status",
      },
    })
    return summarizeAgentJobStatusPayload(payload, {
      action: asString(options.action) || "job_status",
      jobID: id,
    })
  } catch (error) {
    const message = asString(error?.message || String(error || ""))
    const notFound = message.includes("HTTP 404") || message.toLowerCase().includes("job not found")
    const classified = classifyToolError(error)
    return {
      ok: false,
      job_id: id,
      action: asString(options.action) || "job_status",
      state: notFound ? "not_found" : "error",
      terminal: true,
      progress: undefined,
      progress_percent: undefined,
      error_code: notFound ? "job_not_found" : classified.code,
      error_message: excerptText(message),
      summary_for_user: notFound
        ? `未找到本地任务 ${id}。请确认 job_id 来自同一个 dbt-agentd 会话，或重新启动烧写任务。`
        : `查询本地任务 ${id} 状态失败：${excerptText(message, 240)}`,
    }
  }
}

function reviewSourceFile(language, source, capability, binaryName) {
  const normalized = String(language || "c").trim().toLowerCase()
  const ext = normalized === "c++" || normalized === "cpp" || normalized === "cxx" ? "cpp" : "c"
  const cwd = process.cwd()
  const base = sanitizeArtifactBaseName(binaryName || `${capability || "dbt"}_generated`)
  const file = path.join(cwd, `${base}.${ext}`)
  writeFileSync(file, normalizeCStringLiteralNewlines(source, language), "utf8")
  return { file, base, cwd }
}

function advancedToolsEnabled() {
  const value = String(
    process.env.DBT_OPENCODE_EXPOSE_ADVANCED_TOOLS ||
      process.env.OPENCODE_DBT_EXPOSE_ADVANCED_TOOLS ||
      "",
  )
    .trim()
    .toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

function configuredBoardForToolSurface() {
  const runtime = readRuntimeConfig()
  return normalizeBoardID(
    process.env.DBT_OPENCODE_BOARD ||
      process.env.OPENCODE_DBT_BOARD ||
      runtime.defaultBoardID ||
      runtime.boardID ||
      ""
  )
}

function configuredOpenCodeToolset() {
  return String(
    process.env.DBT_OPENCODE_TOOLSET ||
      process.env.OPENCODE_DBT_TOOLSET ||
      ""
  ).trim().toLowerCase()
}

function guidanceDisabled() {
  return boolValue(process.env.DBT_OPENCODE_DISABLE_GUIDANCE) ||
    boolValue(process.env.OPENCODE_DBT_DISABLE_GUIDANCE)
}

function parseDispatchArguments(raw) {
  const payload = {}
  const text = asString(raw?.arguments_json)
  if (text) {
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          ok: false,
          error_code: "invalid_arguments_json",
          error_message: "arguments_json must decode to a JSON object",
        }
      }
      Object.assign(payload, parsed)
    } catch (error) {
      return {
        ok: false,
        error_code: "invalid_arguments_json",
        error_message: asString(error?.message || String(error || "")),
      }
    }
  }
  const request = asString(raw?.request)
  if (request && !payload.request) payload.request = request
  return payload
}

function normalizeDispatchAction(value) {
  const key = asString(value).toLowerCase().replace(/[\s_]+/g, "-")
  const aliases = new Map([
    ["status", "status"],
    ["current-status", "status"],
    ["current-board-status", "status"],
    ["devices", "list-devices"],
    ["list-devices", "list-devices"],
    ["connected-devices", "list-devices"],
    ["flash", "flash-image"],
    ["flash-image", "flash-image"],
    ["flash-start", "flash-start"],
    ["start-flash", "flash-start"],
    ["start-flash-image", "flash-start"],
    ["flash-image-start", "flash-start"],
    ["init-image", "flash-image"],
    ["initial-image", "flash-image"],
    ["factory-flash", "flash-image"],
    ["job-status", "job-status"],
    ["status-job", "job-status"],
    ["flash-status", "job-status"],
    ["progress", "job-status"],
    ["prepare", "prepare"],
    ["resolve", "prepare"],
    ["capabilities", "capabilities"],
    ["board-capabilities", "capabilities"],
    ["capability-summaries", "capability-summaries"],
    ["capability-context", "capability-context"],
    ["board-config", "board-config"],
    ["config", "board-config"],
    ["env-check", "env-check"],
    ["environment-check", "env-check"],
    ["env-install", "env-install"],
    ["environment-install", "env-install"],
    ["usbnet", "usbnet"],
    ["ensure-usbnet", "usbnet"],
    ["logo", "update-logo"],
    ["update-logo", "update-logo"],
    ["chip-probe", "chip-probe"],
    ["probe-chip", "chip-probe"],
    ["cpu-frequency", "cpu-frequency"],
    ["ddr-frequency", "ddr-frequency"],
    ["cpu-temperature", "cpu-temperature"],
    ["temperature", "cpu-temperature"],
    ["processes", "processes"],
    ["process", "processes"],
    ["list-processes", "processes"],
    ["board-processes", "processes"],
    ["ps", "processes"],
    ["wireless-probe", "wireless-probe"],
    ["wifi-bluetooth-probe", "wireless-probe"],
    ["connect-wifi", "connect-wifi"],
    ["scan-wifi", "scan-wifi"],
    ["wifi-scan", "scan-wifi"],
    ["scan-bluetooth", "scan-bluetooth"],
    ["bluetooth-scan", "scan-bluetooth"],
    ["build-run", "build-run"],
    ["run-program", "build-run"],
    ["check-plugin-update", "check-plugin-update"],
    ["update-plugin", "update-plugin"],
    ["rp2350-detect", "rp2350-detect"],
    ["rp2350-flash", "rp2350-flash"],
    ["rp2350-verify", "rp2350-verify"],
    ["rp2350-run", "rp2350-run"],
    ["rp2350-logs", "rp2350-logs"],
    ["rp2350-tail-logs", "rp2350-logs"],
    ["rp2350-build-flash", "rp2350-build-flash"],
  ])
  return aliases.get(key) || key
}

function dispatchTargetToolName(action) {
  const map = new Map([
    ["status", "dbt_current_board_status"],
    ["list-devices", "dbt_list_connected_devices"],
    ["flash-image", "dbt_flash_image"],
    ["flash-start", "dbt_start_flash_image"],
    ["job-status", "dbt_get_job_status"],
    ["prepare", "dbt_prepare_request"],
    ["capabilities", "dbt_get_board_capabilities"],
    ["capability-summaries", "dbt_list_capability_summaries"],
    ["capability-context", "dbt_get_capability_context"],
    ["board-config", "dbt_get_board_config"],
    ["env-check", "dbt_check_board_environment"],
    ["env-install", "dbt_install_board_environment"],
    ["usbnet", "dbt_ensure_usbnet"],
    ["update-logo", "dbt_update_logo"],
    ["chip-probe", "dbt_probe_chip_control"],
    ["cpu-frequency", "dbt_get_cpu_frequency"],
    ["ddr-frequency", "dbt_get_ddr_frequency"],
    ["cpu-temperature", "dbt_get_cpu_temperature"],
    ["processes", "dbt_list_board_processes"],
    ["wireless-probe", "dbt_probe_wifi_bluetooth"],
    ["connect-wifi", "dbt_connect_wifi"],
    ["scan-wifi", "dbt_scan_wifi_networks"],
    ["scan-bluetooth", "dbt_scan_bluetooth_devices"],
    ["build-run", "dbt_build_run_program"],
    ["check-plugin-update", "dbt_check_plugin_update"],
    ["update-plugin", "dbt_update_plugin"],
    ["rp2350-detect", "dbt_rp2350_detect"],
    ["rp2350-flash", "dbt_rp2350_flash"],
    ["rp2350-verify", "dbt_rp2350_verify"],
    ["rp2350-run", "dbt_rp2350_run"],
    ["rp2350-logs", "dbt_rp2350_tail_logs"],
    ["rp2350-build-flash", "dbt_rp2350_build_flash_source"],
  ])
  return map.get(action) || ""
}

function geminiAliasToolNames() {
  return new Set([
    "dbtstatus",
    "dbtlistdevices",
    "dbtflashimage",
    "dbtflashstart",
    "dbtjobstatus",
    "dbtprepare",
    "dbtcapabilities",
    "dbtcapabilitysummaries",
    "dbtcapabilitycontext",
    "dbtboardconfig",
    "dbtenvcheck",
    "dbtenvinstall",
    "dbtusbnet",
    "dbtupdatelogo",
    "dbtchipprobe",
    "dbtcpufrequency",
    "dbtddrfrequency",
    "dbtcputemperature",
    "dbtprocesses",
    "dbtwirelessprobe",
    "dbtconnectwifi",
    "dbtwifiscan",
    "dbtbluetoothscan",
    "dbtbuildrun",
    "dbtcheckpluginupdate",
    "dbtupdateplugin",
  ])
}

function defaultOpenCodeToolNames(connectedBoard) {
  const configuredToolset = configuredOpenCodeToolset()
  if (configuredToolset === "none") {
    return new Set()
  }
  if (configuredToolset === "alias") {
    return geminiAliasToolNames()
  }
  if (configuredToolset === "dispatch") {
    return new Set(["dbttool"])
  }
  if (configuredToolset === "status") {
    return new Set(["dbt_current_board_status"])
  }
  if (configuredToolset === "smoke") {
    return new Set([
      "dbt_current_board_status",
      "dbt_flash_image",
      "dbt_check_plugin_update",
    ])
  }

  return geminiAliasToolNames()
}

function sanitizeStatusPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const copy = { ...payload }
  const repoRoot = typeof copy.repo_root === "string" ? copy.repo_root : ""
  const runtimeSuffix = "/Contents/Resources/toolkit-runtime"
  if (repoRoot.endsWith(runtimeSuffix)) {
    copy.toolkit_root = repoRoot
    copy.install_root = repoRoot.slice(0, -runtimeSuffix.length)
    delete copy.repo_root
    return copy
  }
  return copy
}

function classifyToolError(error) {
  const message = asString(error?.message || String(error || ""))
  const lowered = message.toLowerCase()
  if (lowered.includes("timeout")) {
    return {
      code: "timeout",
      retryable: true,
    }
  }
  if (
    lowered.includes("econnrefused") ||
    lowered.includes("ecconnrefused") ||
    lowered.includes("socket hang up") ||
    lowered.includes("connect") ||
    lowered.includes("127.0.0.1:18082") ||
    lowered.includes("127.0.0.1:18083")
  ) {
    return {
      code: "agent_unreachable",
      retryable: true,
    }
  }
  if (lowered.includes("http 5")) {
    return {
      code: "agent_internal_error",
      retryable: true,
    }
  }
  return {
    code: "tool_error",
    retryable: false,
  }
}

function buildToolFailurePayload(toolName, error, extra = {}) {
  const message = asString(error?.message || String(error || "unknown tool error")) || "unknown tool error"
  const classified = classifyToolError(error)
  let summary = "当前无法完成开发板状态查询。"
  if (classified.code === "timeout") {
    summary = "当前开发板状态查询超时。你可以稍后重试；如果问题持续，请检查本地 dbt-agentd 和运行时是否正常。"
  } else if (classified.code === "agent_unreachable") {
    summary = "当前无法连接本地 DBT Agent。请确认 dbt-agentd 已启动，然后重试。"
  } else if (classified.code === "agent_internal_error") {
    summary = "本地 DBT Agent 返回了内部错误，当前无法完成状态查询。请稍后重试。"
  }
  return {
    ok: false,
    tool_name: toolName,
    tool_error: true,
    error_code: classified.code,
    retryable: classified.retryable,
    error_message: message,
    summary_for_user: summary,
    response_hint:
      "If this tool returns tool_error=true or ok=false, explain the failure directly to the user and do not stop with an empty reply.",
    ...extra,
  }
}

function buildStatusOverview(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const runtimeStatus = payload.runtime_status && typeof payload.runtime_status === "object" ? payload.runtime_status : {}
  const device = runtimeStatus.device && typeof runtimeStatus.device === "object" ? runtimeStatus.device : {}
  const devices = Array.isArray(payload.devices)
    ? payload.devices.filter((item) => item && typeof item === "object" && item.connected === true)
    : []
  const activeDeviceID = asString(payload.active_device_id || payload.device_id)
  const activeDevice = devices.find((item) => asString(item.device_id) === activeDeviceID) || devices[0] || null
  const connected = payload.connected_device === true || device.connected === true
  const boardID = asString(activeDevice?.display_label) || asString(activeDevice?.display_name) || asString(payload.display_label) || asString(payload.display_name) || asString(payload.board_id) || asString(device.display_label) || asString(device.display_name) || asString(device.board_id)
  const variantID = asString(activeDevice?.variant_id) || asString(payload.variant_id) || asString(device.variant_id)
  const transportName = asString(activeDevice?.transport_name) || asString(payload.transport_name) || asString(device.transport_name)
  const interfaceName = asString(activeDevice?.interface_name) || asString(payload.interface_name) || asString(device.interface_name)
  const boardIP = asString(activeDevice?.board_ip) || asString(payload.board_ip)
  const hostIP = asString(payload.host_ip)
  const summary = asString(payload.summary) || asString(runtimeStatus.summary) || (connected ? "开发板已连接" : "没有开发板设备连接")
  const deviceSummary = asString(payload.device_summary) || asString(runtimeStatus.device_summary)
  const updatedAt = asString(payload.updated_at) || asString(runtimeStatus.updated_at)
  const usbEcmReady = payload.usb_ecm_ready === true
  const sshReady = payload.ssh_ready === true
  const controlServiceReady = payload.control_service_ready === true
  const rp2350State = asString(runtimeStatus.rp2350?.state).toLowerCase()
  const isRP2350 = boardID === "ColorEasyPICO2" || transportName.includes("RP2350") || rp2350State === "bootsel" || rp2350State === "runtime-resettable"

  const lines = []
  if (connected) {
    if (devices.length > 1) {
      lines.push(`当前连接了 ${devices.length} 台开发板。`)
      if (activeDevice) {
        const activeDisplay = asString(activeDevice.display_label) || asString(activeDevice.display_name) || asString(activeDevice.board_id) || "未知开发板"
        const activeTransport = asString(activeDevice.transport_name)
        lines.push(`当前活动设备：${activeDisplay}${activeTransport && !activeDisplay.includes(activeTransport) ? `，链路 ${activeTransport}` : ""}`)
      }
      lines.push("已连接设备：")
      for (const item of devices) {
        const display = asString(item.display_label) || asString(item.display_name) || asString(item.board_id) || "未知开发板"
        const transport = asString(item.transport_name)
        const locator = asString(item.transport_locator) || asString(item.interface_name) || asString(item.board_ip)
        const suffix = locator ? ` @ ${locator}` : ""
        lines.push(`- ${display}${transport && !display.includes(transport) ? `，${transport}` : ""}${suffix}`)
      }
      if (updatedAt) lines.push(`更新时间：${updatedAt}`)
    } else {
    lines.push(`设备：${boardID || "未知开发板"}${variantID ? ` / ${variantID}` : ""}`)
    lines.push(`连接：已连接${transportName ? `，链路 ${transportName}` : ""}${interfaceName ? ` (${interfaceName})` : ""}`)
    if (isRP2350) {
      const runtimePort = asString(runtimeStatus.rp2350?.runtime_port?.device)
      const rpSummary = asString(runtimeStatus.rp2350?.summary_for_user) || asString(payload.summary) || deviceSummary || "单 USB 运行态已就绪"
      if (runtimePort) {
        lines.push(`串口：${runtimePort}`)
      }
      lines.push(`状态：${rpSummary}`)
      lines.push("可用操作：进入 BOOTSEL、刷写 UF2、校验 UF2、恢复运行态、读取串口日志、回读 Flash")
      if (updatedAt) lines.push(`更新时间：${updatedAt}`)
    } else {
      if (hostIP || boardIP) {
        lines.push(`网络：主机 ${hostIP || "-"} / 开发板 ${boardIP || "-"}`)
      }
      lines.push(`USB ECM：${usbEcmReady ? "已就绪" : "未就绪"}`)
      lines.push(`SSH：${sshReady ? "正常" : "不可用"}`)
      lines.push(`控制服务：${controlServiceReady ? "正常" : "不可用"}`)
      if (deviceSummary) lines.push(`链路摘要：${deviceSummary}`)
      if (updatedAt) lines.push(`更新时间：${updatedAt}`)
    }
    }
  } else {
    lines.push("当前没有开发板设备连接。")
    if (updatedAt) lines.push(`最后更新时间：${updatedAt}`)
  }

  return {
    connected_device: connected,
    board_id: boardID,
    variant_id: variantID,
    transport_name: transportName,
    interface_name: interfaceName,
    board_ip: boardIP,
    host_ip: hostIP,
    device_id: activeDeviceID,
    active_device_id: activeDeviceID,
    devices,
    usb_ecm_ready: usbEcmReady,
    ssh_ready: sshReady,
    control_service_ready: controlServiceReady,
    summary,
    device_summary: deviceSummary,
    updated_at: updatedAt,
    lines,
    summary_for_user: lines.join("\n"),
  }
}

function enrichStatusPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  if (payload.tool_error === true || payload.ok === false) {
    if (asString(payload.summary_for_user)) {
      return payload
    }
    return {
      ...payload,
      summary_for_user: "当前无法完成开发板状态查询。",
      response_hint:
        "If this tool returns tool_error=true or ok=false, explain summary_for_user directly to the user.",
    }
  }
  const overview = buildStatusOverview(payload)
  if (!overview) return payload
  return {
    ...payload,
    status_overview: overview,
    summary_for_user: overview.summary_for_user,
    response_hint:
      "For current board status questions, answer directly from summary_for_user. Keep only fields relevant to the current board class, and do not mention unsupported capabilities.",
  }
}

function compactStatusPayload(payload) {
  const enriched = enrichStatusPayload(payload)
  if (!enriched || typeof enriched !== "object" || Array.isArray(enriched)) return enriched
  if (enriched.tool_error === true || enriched.ok === false) {
    return {
      ok: enriched.ok === false ? false : undefined,
      tool_error: enriched.tool_error === true ? true : undefined,
      board_id: asString(enriched.board_id) || null,
      variant_id: asString(enriched.variant_id) || null,
      device_id: asString(enriched.device_id) || asString(enriched.active_device_id) || null,
      active_device_id: asString(enriched.active_device_id) || asString(enriched.device_id) || null,
      summary_for_user: asString(enriched.summary_for_user) || "当前无法完成开发板状态查询。",
      response_hint:
        asString(enriched.response_hint) ||
        "If this tool returns ok=false or tool_error=true, explain summary_for_user directly to the user.",
    }
  }
  const devices = Array.isArray(enriched.devices)
    ? enriched.devices
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          device_id: asString(item.device_id) || null,
          device_uid: asString(item.device_uid) || null,
          board_id: asString(item.board_id) || null,
          variant_id: asString(item.variant_id) || null,
          display_label: asString(item.display_label) || null,
          display_name: asString(item.display_name) || null,
          interface_name: asString(item.interface_name) || null,
          transport_name: asString(item.transport_name) || null,
          transport_locator: asString(item.transport_locator) || null,
          connected: item.connected === true,
        }))
    : []
  const overview = enriched.status_overview && typeof enriched.status_overview === "object" && !Array.isArray(enriched.status_overview)
    ? enriched.status_overview
    : null
  return {
    ok: true,
    connected_device: enriched.connected_device === true,
    board_id: asString(enriched.board_id) || null,
    variant_id: asString(enriched.variant_id) || null,
    device_id: asString(enriched.device_id) || asString(enriched.active_device_id) || null,
    active_device_id: asString(enriched.active_device_id) || asString(enriched.device_id) || null,
    display_name: asString(enriched.display_name) || null,
    display_label: asString(enriched.display_label) || null,
    interface_name: asString(enriched.interface_name) || null,
    transport_name: asString(enriched.transport_name) || null,
    transport_locator: asString(enriched.transport_locator) || null,
    device_summary: asString(enriched.device_summary) || null,
    summary: asString(enriched.summary) || null,
    updated_at: asString(enriched.updated_at) || null,
    devices,
    status_overview: overview
      ? {
          connected_device: overview.connected_device === true,
          board_id: asString(overview.board_id) || null,
          variant_id: asString(overview.variant_id) || null,
          device_id: asString(overview.device_id) || null,
          active_device_id: asString(overview.active_device_id) || null,
          summary: asString(overview.summary) || null,
          device_summary: asString(overview.device_summary) || null,
          updated_at: asString(overview.updated_at) || null,
          lines: Array.isArray(overview.lines) ? overview.lines.filter((line) => asString(line)) : [],
          summary_for_user: asString(overview.summary_for_user) || asString(enriched.summary_for_user) || null,
        }
      : null,
    summary_for_user: asString(enriched.summary_for_user) || null,
    response_hint:
      asString(enriched.response_hint) ||
      "For current board status questions, answer directly from summary_for_user.",
  }
}

function summarizeConnectedDevicesPayload(payload) {
  const enriched = enrichStatusPayload(payload)
  const devices = Array.isArray(enriched?.devices)
    ? enriched.devices.filter((item) => item && typeof item === "object" && item.connected === true)
    : []
  const activeDeviceID = asString(enriched?.active_device_id || enriched?.device_id)
  const lines = devices.map((item) => {
    const display = asString(item.display_label) || asString(item.display_name) || asString(item.board_id) || "未知开发板"
    const transport = asString(item.transport_name)
    const locator = asString(item.transport_locator) || asString(item.interface_name) || asString(item.board_ip)
    const activeMark = asString(item.device_id) === activeDeviceID ? " [active]" : ""
    return `${display}${transport && !display.includes(transport) ? `，${transport}` : ""}${locator ? ` @ ${locator}` : ""}${activeMark}`
  })
  return {
    ok: true,
    active_device_id: activeDeviceID || null,
    devices,
    summary_for_user: devices.length
      ? `当前连接了 ${devices.length} 台开发板。\n${lines.map((line) => `- ${line}`).join("\n")}`
      : "当前没有连接开发板。",
  }
}

async function getStatusWithAutoRepair() {
  try {
    return sanitizeStatusPayload(await localAgentJSON("/v1/status/live", { timeoutMs: 6000 }))
  } catch (liveError) {
    const cached = await tryLocalAgentJSON("/v1/status/summary", { timeoutMs: 2500 })
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      return {
        ...sanitizeStatusPayload(cached),
        degraded_status: true,
        degraded_reason: asString(liveError?.message || String(liveError || "")),
        summary_for_user:
          asString(cached.summary_for_user) ||
          "当前返回的是缓存状态，实时状态查询失败。你可以重试一次，或检查本地 dbt-agentd 是否正常。",
        response_hint:
          "This is a degraded cached status result because live status failed. Tell the user it is cached if that matters.",
      }
    }
    return buildToolFailurePayload("dbt_current_board_status", liveError)
  }
}

async function getCachedStatusSummary() {
  const cached = await tryLocalAgentJSON("/v1/status/summary", { timeoutMs: 2500 })
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return sanitizeStatusPayload(cached)
  }
  return getStatusWithAutoRepair()
}

function shouldForceLiveStatus(reason) {
  const text = asString(reason).toLowerCase()
  if (!text) return false
  return [
    "live",
    "fresh",
    "refresh",
    "recheck",
    "实时",
    "刷新",
    "重新检测",
    "重新探测",
    "最新状态",
  ].some((keyword) => text.includes(keyword))
}

async function getPluginStatus(options = {}) {
  if (options.live === true) {
    return getStatusWithAutoRepair()
  }
  return getCachedStatusSummary()
}

async function resolveConnectedBoard(explicitBoard, explicitVariant) {
  const { board, variant } = normalizeBoardVariantInput(explicitBoard, explicitVariant)
  if (board && variant) return { board, variant }

  const status = await getPluginStatus()
  const runtimeStatus = status && typeof status === "object" && status.runtime_status && typeof status.runtime_status === "object"
    ? status.runtime_status
    : {}
  const device = runtimeStatus.device && typeof runtimeStatus.device === "object" ? runtimeStatus.device : {}
  const connected = status && typeof status === "object"
    ? status.connected_device === true || device.connected === true
    : false
  if (!connected) {
    throw new Error("No connected development board detected. Connect hardware first, or pass board and variant explicitly.")
  }

  const resolvedBoard = board || asString(status?.board_id) || asString(device.board_id)
  const resolvedVariant = variant || asString(status?.variant_id) || asString(device.variant_id)
  const resolvedDeviceID = asString(status?.active_device_id || status?.device_id)
  if (!resolvedBoard) {
    throw new Error("Connected device does not expose board_id. Pass --board explicitly.")
  }
  return {
    board: resolvedBoard,
    variant: resolvedVariant,
    device_id: resolvedDeviceID,
  }
}

async function inferSingleKnownVariant(board) {
  const targetBoard = asString(board)
  if (!targetBoard) return ""
  try {
    const payload = await localAgentTool("list_boards", {}, { timeoutMs: 6000 })
    const boards = Array.isArray(payload?.boards) ? payload.boards : []
    const match = boards.find((item) => asString(item?.id) === targetBoard)
    if (!match || !Array.isArray(match.variants)) return ""

    const variants = match.variants
      .map((item) => ({
        variant: asString(item?.variant_id),
        status: asString(item?.status).toLowerCase(),
      }))
      .filter((item) => item.variant)

    const supported = variants.filter((item) => item.status === "supported")
    if (supported.length === 1) return supported[0].variant
    if (variants.length === 1) return variants[0].variant
  } catch {
    // Leave variant unresolved and let the runtime surface a precise error if needed.
  }
  return ""
}

async function resolveBoardVariantIfConnected(explicitBoard, explicitVariant) {
  const { board, variant } = normalizeBoardVariantInput(explicitBoard, explicitVariant)
  if (!board) return { board: "", variant: "" }
  if (variant) return { board, variant }

  try {
    const status = await getPluginStatus()
    const device = status && typeof status === "object" ? status.device : null
    if (device && typeof device === "object" && device.connected === true) {
      const connectedBoard = asString(device.board_id)
      const connectedVariant = asString(device.variant_id)
      if (connectedBoard === board && connectedVariant) {
        return {
          board,
          variant: connectedVariant,
          device_id: asString(status?.active_device_id || status?.device_id),
        }
      }
    }
  } catch {
    // Keep the explicit board and let the runtime decide whether variant is mandatory.
  }

  return { board, variant: await inferSingleKnownVariant(board), device_id: "" }
}

function connectedDeviceRecords(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return []
  const devices = Array.isArray(status.devices) ? status.devices : []
  return devices.filter((item) => item && typeof item === "object" && item.connected === true)
}

function describeDeviceChoice(item) {
  const display = asString(item.display_label) || asString(item.display_name) || asString(item.board_id) || "unknown"
  const deviceID = asString(item.device_id)
  const locator = asString(item.transport_locator) || asString(item.interface_name)
  return `${display}${deviceID ? ` [${deviceID}]` : ""}${locator ? ` @ ${locator}` : ""}`
}

function sanitizeExplicitDeviceID(status, explicitDeviceID, board, variant) {
  const requested = asString(explicitDeviceID)
  if (!requested) return ""
  const devices = connectedDeviceRecords(status)
  const exact = devices.find((item) => asString(item.device_id) === requested)
  if (!exact) return ""
  const resolvedBoard = normalizeBoardID(exact.board_id)
  const resolvedVariant = normalizeVariantID(resolvedBoard, exact.variant_id)
  if (board && resolvedBoard && board !== resolvedBoard && !(board === "RP2350" && isRP2350FamilyBoard(resolvedBoard))) return ""
  if (variant && resolvedVariant && variant !== resolvedVariant) return ""
  return requested
}

async function resolveConnectedMutationTarget(explicitBoard, explicitVariant, explicitDeviceID) {
  const { board, variant } = normalizeBoardVariantInput(explicitBoard, explicitVariant)
  const requestedDeviceID = asString(explicitDeviceID)
  const status = await getStatusWithAutoRepair()
  const devices = connectedDeviceRecords(status)
  if (devices.length === 0) {
    throw new Error("No connected development board detected. Connect hardware first, or pass board and variant explicitly for knowledge-only queries.")
  }

  if (requestedDeviceID) {
    const exact = devices.find((item) => asString(item.device_id) === requestedDeviceID)
    if (!exact) {
      throw new Error(`Requested device_id not found among connected devices: ${requestedDeviceID}`)
    }
    const resolvedBoard = normalizeBoardID(exact.board_id)
    const resolvedVariant = normalizeVariantID(resolvedBoard, exact.variant_id)
    if (board && resolvedBoard && board !== resolvedBoard && !(board === "RP2350" && isRP2350FamilyBoard(resolvedBoard))) {
      throw new Error(`device_id ${requestedDeviceID} belongs to ${resolvedBoard}, not ${board}`)
    }
    if (variant && resolvedVariant && variant !== resolvedVariant) {
      throw new Error(`device_id ${requestedDeviceID} belongs to variant ${resolvedVariant}, not ${variant}`)
    }
    return {
      board: resolvedBoard || board,
      variant: resolvedVariant || variant,
      device_id: requestedDeviceID,
    }
  }

  const filtered = devices.filter((item) => {
    const itemBoard = normalizeBoardID(item.board_id)
    const itemVariant = normalizeVariantID(itemBoard, item.variant_id)
    if (board && board !== "RP2350" && itemBoard !== board) return false
    if (board === "RP2350" && !isRP2350FamilyBoard(itemBoard)) return false
    if (variant && itemVariant !== variant) return false
    return true
  })

  if (filtered.length === 1) {
    const only = filtered[0]
    const onlyBoard = normalizeBoardID(only.board_id)
    return {
      board: onlyBoard || board,
      variant: normalizeVariantID(onlyBoard, only.variant_id) || variant,
      device_id: asString(only.device_id),
    }
  }

  const candidates = filtered.length > 0 ? filtered : devices
  const scopeText = board
    ? `${board}${variant ? `/${variant}` : ""}`
    : "the current request"
  const listed = candidates.map(describeDeviceChoice).join("; ")
  throw new Error(
    `Multiple connected devices match ${scopeText}. Specify device_id explicitly. Candidates: ${listed}`
  )
}

async function resolveConnectedRP2350FamilyTarget(explicitDeviceID) {
  const requestedDeviceID = asString(explicitDeviceID)
  const status = await getStatusWithAutoRepair()
  const devices = connectedDeviceRecords(status).filter((item) => {
    const itemBoard = normalizeBoardID(item.board_id)
    return isRP2350FamilyBoard(itemBoard)
  })
  if (devices.length === 0) {
    throw new Error("No connected RP2350-family development board detected.")
  }

  if (requestedDeviceID) {
    const exact = devices.find((item) => asString(item.device_id) === requestedDeviceID)
    if (!exact) {
      throw new Error(`Requested device_id not found among connected RP2350-family devices: ${requestedDeviceID}`)
    }
    const exactBoard = normalizeBoardID(exact.board_id)
    return {
      board: exactBoard,
      variant: normalizeVariantID(exactBoard, exact.variant_id),
      device_id: requestedDeviceID,
    }
  }

  if (devices.length === 1) {
    const only = devices[0]
    const onlyBoard = normalizeBoardID(only.board_id)
    return {
      board: onlyBoard,
      variant: normalizeVariantID(onlyBoard, only.variant_id),
      device_id: asString(only.device_id),
    }
  }

  const listed = devices.map(describeDeviceChoice).join("; ")
  throw new Error(
    `Multiple connected RP2350-family devices are available. Specify device_id explicitly. Candidates: ${listed}`
  )
}

function localPublishedBoardManifestPath(board) {
  const targetBoard = asString(board)
  if (!targetBoard) return ""
  return path.join(
    homeDir(),
    "Library",
    "Application Support",
    "development-board-toolchain",
    "agent",
    "registry",
    "published",
    "boards",
    targetBoard,
    "board.json",
  )
}

function readLocalPublishedCapabilities(board) {
  try {
    const manifestPath = localPublishedBoardManifestPath(board)
    if (!manifestPath || !existsSync(manifestPath)) return []
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"))
    const capabilities = Array.isArray(parsed?.capabilities) ? parsed.capabilities : []
    return capabilities.map((item) => asString(item)).filter(Boolean).sort()
  } catch {
    return []
  }
}

async function assertCapabilityAvailable(board, variant, capability) {
  const targetBoard = asString(board)
  const targetCapability = asString(capability)
  if (!targetBoard || !targetCapability) return
  const localQuery = new URLSearchParams({
    board_id: targetBoard,
    variant_id: asString(variant),
    capability_id: targetCapability,
  }).toString()
  const local = await tryLocalAgentJSON(`/v1/context/capability?${localQuery}`, { timeoutMs: 4000 })
  if (local && typeof local === "object" && !asString(local.error)) {
    return
  }
  const available = readLocalPublishedCapabilities(targetBoard)
  throw new Error(
    `Capability "${targetCapability}" is not available for ${targetBoard}${asString(variant) ? `/${asString(variant)}` : ""}. Available capabilities: ${available.join(", ") || "none"}.`
  )
}

async function appendUpdateNoticeIfNeeded(payload, toolkitRoot) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  maybeStartBackgroundUpdateCheck(toolkitRoot)
  return appendCachedUpdateNotice(payload, toolkitRoot)
}

export const pluginInfo = {
  name: "DBT-Agent",
  displayName: "DBT-Agent",
  description: "development-board-toolchain board control, capability planning, flashing, and environment tooling for OpenCode.",
}

async function performPluginUpdate(options = {}) {
  const toolkitRoot = resolveToolkitRoot()
  const installRoot = inferInstallRoot(toolkitRoot)
  const explicitSource = asString(options.source)
  const manifestSource = explicitSource || resolveUpdateManifestSource()
  const repositorySource = resolveUpdateRepository()
  const force = options.force === true || String(options.force || "").trim().toLowerCase() === "true"

  if (manifestSource) assertUpdateSourceAllowed(manifestSource, "update manifest")
  if (repositorySource) assertUpdateSourceAllowed(repositorySource, "update repository")

  const tempRoot = mkdtempSync(path.join(tmpdir(), "dbt-opencode-update-"))
  const cloneDir = path.join(tempRoot, "repo")
  try {
    const manifest = manifestSource
      ? await requestJSON(manifestSource).catch(() => null)
      : null
    const manifestRepositorySource =
      manifest && typeof manifest === "object" && !Array.isArray(manifest)
        ? resolveManifestReference(
            manifestSource,
            manifest.repository_url || manifest.update_repository || manifest.repository || ""
          )
        : ""
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      const installerSource = resolveManifestReference(
        manifestSource,
        manifest.installer_url || manifest.installer_path || ""
      )
      if (installerSource) {
        const installerPath = path.join(tempRoot, "install-opencode-plugin.sh")
        await materializeTextResource(installerSource, installerPath)
        const args = [installerPath, "--install-dir", installRoot, "--with-opencode"]
        if (force) args.push("--force")
        args.push("--manifest-url", manifestSource)
        const { stdout, stderr } = await execFileAsync("/bin/bash", args, {
          cwd: tempRoot,
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            DBT_TOOLKIT_ROOT: installRoot,
            DBT_OPENCODE_RELEASE_MANIFEST_URL: manifestSource,
          },
        })

        const localVersion = readLocalUpdateVersion(installRoot)
        const remoteVersion = asString(manifest.version) || localVersion
        writeUpdateState({
          checking: false,
          last_checked_at: isoNow(),
          local_version: localVersion,
          remote_version: remoteVersion,
          update_available: false,
          message: `Development Board Toolchain updated to ${localVersion}`,
          toolkit_root: installRoot,
          update_manifest_url: manifestSource,
        })

        return {
          ok: true,
          install_root: installRoot,
          toolkit_root: installRoot,
          update_manifest_url: manifestSource,
          version: localVersion,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
        }
      }
    }

    const fallbackSource = explicitSource
      ? (isLikelyRepositorySource(explicitSource) ? explicitSource : (manifestRepositorySource || repositorySource))
      : (manifestRepositorySource || repositorySource)
    if (fallbackSource) assertUpdateSourceAllowed(fallbackSource, "update repository")
    if (!fallbackSource) {
      throw new Error(
        manifestSource
          ? `Release manifest is unavailable and no update repository is configured: ${manifestSource}`
          : "No update source is configured for Development Board Toolchain."
      )
    }

    let sourceRoot = cloneDir
    if (localUpdateSourcesAllowed() && existsSync(fallbackSource)) {
      sourceRoot = path.resolve(fallbackSource)
    } else {
      await execFileAsync("git", ["clone", "--depth", "1", fallbackSource, cloneDir], {
        maxBuffer: 32 * 1024 * 1024,
        env: process.env,
      })
    }

    const runtimeReleaseRoot = path.join(sourceRoot, "product_release", "runtime")
    const runtimeBundleDir = existsSync(runtimeReleaseRoot)
      ? readdirSync(runtimeReleaseRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith("development-board-toolchain-runtime-"))
          .map((entry) => path.join(runtimeReleaseRoot, entry.name, "install.sh"))
      : []
    const candidateInstallers = [
      path.join(sourceRoot, "install.sh"),
      path.join(sourceRoot, "release", "install-opencode.sh"),
      path.join(sourceRoot, "opencode_plugin", "release", "install.sh"),
      path.join(sourceRoot, "product_release", "runtime", "install.sh"),
      ...runtimeBundleDir,
      path.join(sourceRoot, "public_release", "install.sh"),
      path.join(sourceRoot, "opencode_plugin_workspace", "public_release", "install.sh"),
    ]
    const installScript = candidateInstallers.find((item) => existsSync(item))
    if (!installScript) {
      throw new Error(`install.sh not found in update source: ${fallbackSource}`)
    }

    const args = [installScript, "--install-dir", installRoot, "--with-opencode"]
    if (force) args.push("--force")
    let stdout = ""
    let stderr = ""
    try {
      const result = await execFileAsync("/bin/bash", args, {
        cwd: path.dirname(installScript),
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          DBT_TOOLKIT_ROOT: installRoot,
        },
      })
      stdout = String(result.stdout || "")
      stderr = String(result.stderr || "")
    } catch (error) {
      const combined = String(
        [error?.message, error?.stderr, error?.stdout].filter(Boolean).join("\n") || ""
      )
      if (
        (combined.includes("releases/latest/download") && combined.includes("404")) ||
        combined.includes("The requested URL returned error: 404") ||
        combined.includes("HTTP 404:")
      ) {
        throw new Error(
          `Plugin update cannot complete because the GitHub release assets for ${repositorySource} are not published yet. The repository version is newer, but install.sh still needs the release manifest and binary archives. Upload the release assets, then retry.`
        )
      }
      throw error
    }

    const localVersion = readLocalUpdateVersion(installRoot)
    writeUpdateState({
      checking: false,
      last_checked_at: isoNow(),
      local_version: localVersion,
      remote_version: localVersion,
      update_available: false,
      message: `Development Board Toolchain updated to ${localVersion}`,
      toolkit_root: installRoot,
      update_source: fallbackSource,
    })

    return {
      ok: true,
      install_root: installRoot,
      toolkit_root: installRoot,
      update_source: fallbackSource,
      version: localVersion,
      stdout: String(stdout || "").trim(),
      stderr: String(stderr || "").trim(),
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

export const DevelopmentBoardToolchainPlugin = async () => {
  const connectedBoardForToolSurface = configuredBoardForToolSurface()
  const executeStatusTool = async (reason) => {
    const payload = compactStatusPayload(await getPluginStatus({ live: shouldForceLiveStatus(reason) }))
    try {
      const root = resolveToolkitRoot()
      return jsonText(await appendUpdateNoticeIfNeeded(payload, root))
    } catch (e) {
      return jsonText(payload)
    }
  }

  const tools = {
      dbt_current_board_status: tool({
        description: "Use immediately for current board status, connection state, USB ECM, SSH, control service, or whether a board is connected. This is the canonical DBT status tool. If no board is connected and the user did not name a board model, do not guess anything else.",
        args: {
          reason: tool.schema.string().optional(),
        },
        async execute(args) {
          return executeStatusTool(args.reason)
        },
      }),
      dbtstatus: tool({
        description: "Get current development board status through local dbt-agentd.",
        args: {
          request: tool.schema.string(),
        },
        async execute(args) {
          return executeStatusTool(args.request)
        },
      }),
      dbt_list_connected_devices: tool({
        description: "List all currently connected development boards with device_id, board, variant, transport, and which one is the active device. Use this when multiple boards are connected or when the user needs to choose a specific device.",
        args: {},
        async execute() {
          return jsonText(summarizeConnectedDevicesPayload(await getPluginStatus()))
        },
      }),
      dbt_list_board_processes: tool({
        description: "List current Linux-board processes from the connected development board through local dbt-agentd. Use this for requests such as '当前开发板有哪些进程' or '列出板端正在运行的进程'. This is for Linux boards like TaishanPi, not RP2350-family microcontrollers.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          name_filter: tool.schema.string().optional(),
          limit: tool.schema.string().optional(),
        },
        async execute(args) {
          const normalized = normalizeBoardVariantInput(args.board, args.variant)
          const requestedLimit = Number.parseInt(asString(args.limit), 10)
          let sanitizedDeviceID = ""
          try {
            const status = await getPluginStatus()
            sanitizedDeviceID = sanitizeExplicitDeviceID(status, args.device_id, normalized.board, normalized.variant)
          } catch {}
          const target = await resolveConnectedMutationTarget(
            normalized.board,
            normalized.variant,
            sanitizedDeviceID,
          )
          const payload = await localAgentTool("list_board_processes", {
            board_id: target.board || normalized.board,
            variant_id: target.variant || normalized.variant,
            device_id: target.device_id,
            name_filter: asString(args.name_filter),
            limit: Number.isFinite(requestedLimit) ? requestedLimit : undefined,
          }, { timeoutMs: 20000 })
          return jsonText(payload)
        },
      }),
      dbt_rp2350_detect: tool({
        description: "Detect the current RP2350-family single-USB state for boards such as ColorEasyPICO2 or Raspberry Pi Pico 2 W. Returns one of bootsel, runtime-resettable, or not-found.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("detect", args, { timeoutMs: 15000 }))
        },
      }),
      dbt_rp2350_set_board_model: tool({
        description: "Bind the currently connected RP2350 runtime device to a specific board model such as ColorEasyPICO2 or RaspberryPiPico2W. Use this for first-time initialization so later knowledge and control requests can target the correct board type.",
        args: {
          board: tool.schema.string(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("set_board_model", args, { timeoutMs: 30000 }))
        },
      }),
      dbt_rp2350_enter_bootsel: tool({
        description: "Switch the connected RP2350-family board into BOOTSEL mode through the validated single-USB workflow.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("enter_bootsel", args, { timeoutMs: 45000 }))
        },
      }),
      dbt_rp2350_flash: tool({
        description: "Flash a UF2 to a connected RP2350-family board through the validated single-USB workflow. Resolve uf2_path relative to the current OpenCode workspace.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          uf2_path: tool.schema.string(),
          allow_runtime_switch: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("flash", args, { timeoutMs: 90000 }))
        },
      }),
      dbt_rp2350_verify: tool({
        description: "Verify a UF2 against the connected RP2350-family board and wait for the board to return to runtime.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          uf2_path: tool.schema.string(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("verify", args, { timeoutMs: 90000 }))
        },
      }),
      dbt_rp2350_run: tool({
        description: "Return the connected RP2350-family board to application runtime after BOOTSEL or runtime-resettable transitions.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("run", args, { timeoutMs: 45000 }))
        },
      }),
      dbt_rp2350_tail_logs: tool({
        description: "Read recent serial logs from the connected RP2350-family runtime path. This is for RP2350 single-USB only, not Linux boards.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          lines: tool.schema.string().optional(),
          follow: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("tail_logs", args, { timeoutMs: 45000 }))
        },
      }),
      dbt_rp2350_save_flash: tool({
        description: "Read back RP2350-family flash into a UF2 file. Resolve output_path relative to the current OpenCode workspace.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          output_path: tool.schema.string(),
        },
        async execute(args) {
          return jsonText(await runRP2350Job("save_flash", args, { timeoutMs: 90000 }))
        },
      }),
      dbt_rp2350_build_flash_source: tool({
        description: "Write reviewed C/C++ source into the current workspace, build a UF2 with the installed RP2350 full_build environment, then flash it through the validated single-USB workflow. Use this for RP2350-family code-generation tasks such as GPIO25 blinking on ColorEasyPICO2 or CYW43 LED / WiFi code on RaspberryPiPico2W. The generated program should be self-contained and should keep USB stdio initialized.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          source: tool.schema.string(),
          language: tool.schema.string().optional(),
          binary_name: tool.schema.string().optional(),
          allow_runtime_switch: tool.schema.string().optional(),
        },
        async execute(args) {
          const language = asString(args.language) || "c"
          const local = reviewSourceFile(language, args.source, "rp2350", args.binary_name)
          const requestedBoard = normalizeBoardID(args.board) || "RP2350"
          const requestedVariant = normalizeVariantID(requestedBoard, args.variant) || requestedBoard
          let sanitizedDeviceID = ""
          try {
            const status = await getStatusWithAutoRepair()
            sanitizedDeviceID = sanitizeExplicitDeviceID(
              status,
              args.device_id,
              requestedBoard,
              requestedVariant,
            )
          } catch {}
          const target = await resolveConnectedMutationTarget(
            requestedBoard,
            requestedVariant,
            sanitizedDeviceID,
          )
          const result = await localAgentTool("rp2350_build_flash_source", {
            board_id: target.board || requestedBoard,
            variant_id: target.variant || requestedVariant,
            device_id: target.device_id,
            source_file: local.file,
            language,
            binary_name: local.base,
            workspace: process.cwd(),
            allow_runtime_switch: typeof args.allow_runtime_switch === "undefined"
              ? true
              : boolValue(args.allow_runtime_switch),
          }, { timeoutMs: 300000 })
          return jsonText(result)
        },
      }),
      dbt_prepare_request: tool({
        description: "High-level request preparation tool after dbt_current_board_status. Use for design, generate, execute, flash, or operator requests. Reuse resolved_board_id, resolved_variant_id, and resolved_capability_id exactly as returned. For design and generation, inspect capability summaries next before fetching full capability context.",
        args: {
          request: tool.schema.string(),
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          capability: tool.schema.string().optional(),
        },
        async execute(args) {
          const normalized = normalizeBoardVariantInput(args.board, args.variant)
          let sanitizedDeviceID = ""
          try {
            const status = await getPluginStatus()
            sanitizedDeviceID = sanitizeExplicitDeviceID(status, args.device_id, normalized.board, normalized.variant)
          } catch {
            sanitizedDeviceID = ""
          }
          const payload = await localAgentJSON("/v1/agent/resolve-scope", {
            method: "POST",
            payload: {
              user_text: asString(args.request),
              board_id: normalized.board,
              variant_id: normalized.variant,
              device_id: sanitizedDeviceID,
              capability_id: normalizeCapabilityAlias(args.capability),
            },
            timeoutMs: 6000,
          })
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            payload.response_rules = [
              "Reuse resolved_board_id, resolved_variant_id, and resolved_capability_id exactly in later DBT tool calls.",
              "Do not invent a new capability id after this tool has already resolved one.",
              "Before fetching full capability context, inspect capability summaries for the resolved board and variant and choose the best candidate capability.",
            ]
          }
          return jsonText(payload)
        },
      }),
      dbt_list_capability_summaries: tool({
        description: "List concise capability summaries for a board and variant. Use after dbt_prepare_request, then choose the best matching capability before fetching full context.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          const query = new URLSearchParams({
            board_id: resolved.board,
            variant_id: resolved.variant,
          }).toString()
          const payload = await localAgentJSON(`/v1/context/capability-summaries?${query}`, { timeoutMs: 6000 })
          return jsonText(summarizeCapabilitySummariesPayload(payload))
        },
      }),
      dbt_get_board_capabilities: tool({
        description: "Get the current board's capability summaries directly. Use this for questions like '当前开发板有什么能力' or '这个开发板支持什么功能'. If board is omitted, it resolves the connected board automatically. Do not call dbt_current_board_status first unless live execution state also matters.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          const query = new URLSearchParams({
            board_id: resolved.board,
            variant_id: resolved.variant,
          }).toString()
          const payload = await localAgentJSON(`/v1/context/capability-summaries?${query}`, { timeoutMs: 6000 })
          return jsonText(summarizeCapabilitySummariesPayload(payload))
        },
      }),
      dbt_list_installed_board_plugins: tool({
        description: "List installed local DBT board plugins from dbt-agentd. Use this only when the user explicitly asks which development boards are already available on this machine. Do not use this to guess a target board after a disconnected status.",
        args: {},
        async execute() {
          return jsonText(await localAgentJSON("/v1/plugins/installed", { timeoutMs: 6000 }))
        },
      }),
      dbt_list_available_board_plugins: tool({
        description: "List remotely available DBT board plugins from the local dbt-agentd catalog snapshot. Use this only when the user explicitly asks which development boards are supported or installable. Do not use this to guess a target board after a disconnected status.",
        args: {},
        async execute() {
          return jsonText(await localAgentJSON("/v1/plugins/available", { timeoutMs: 6000 }))
        },
      }),
      dbt_search_board_plugins: tool({
        description: "Search installed and remotely available DBT board plugins through local dbt-agentd. Use this only when the user explicitly asks to search for a board plugin or board model.",
        args: {
          query: tool.schema.string(),
        },
        async execute(args) {
          const q = encodeURIComponent(asString(args.query))
          return jsonText(await localAgentJSON(`/v1/plugins/search?q=${q}`, { timeoutMs: 6000 }))
        },
      }),
      dbt_check_board_environment: tool({
        description: "Check whether the selected board development environment is ready. Use this when the user asks whether the current board can already support flashing, runtime control, or full firmware development. For RP2350-family boards such as ColorEasyPICO2 and RaspberryPiPico2W, profile can be minimal_runtime or full_build.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          profile: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          const query = new URLSearchParams({
            board_id: resolved.board,
            variant_id: resolved.variant,
            profile: asString(args.profile),
          }).toString()
          return jsonText(await localAgentJSON(`/v1/environment/check?${query}`, { timeoutMs: 12000 }))
        },
      }),
      dbt_install_board_environment: tool({
        description: "Install the selected board development environment through local dbt-agentd. Use this only when the user explicitly asks to install or prepare the development environment. For RP2350-family boards such as ColorEasyPICO2 and RaspberryPiPico2W, profile can be minimal_runtime or full_build.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          profile: tool.schema.string().optional(),
          force: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          return jsonText(await localAgentJSON("/v1/environment/install", {
            method: "POST",
            payload: {
              board_id: resolved.board,
              variant_id: resolved.variant,
              profile: asString(args.profile),
              force: boolValue(args.force),
            },
            timeoutMs: 180000,
          }))
        },
      }),
      dbt_update_plugin: tool({
        description: "Update the Development Board Toolchain standalone runtime and refresh the OpenCode plugin from the configured release manifest. Use this when the user asks to update the plugin/toolchain, or after a cached update notice says a new version is available.",
        args: {
          force: tool.schema.string().optional(),
          source: tool.schema.string().optional(),
        },
        async execute(args) {
          const result = await performPluginUpdate({
            force: args.force,
            source: args.source,
          })
          return jsonText(result)
        },
      }),
      dbt_check_plugin_update: tool({
        description: "Check the cached Development Board Toolchain update state, and trigger a background refresh if the cache is older than one day. Prefer the configured release manifest and fall back to the legacy version source only if needed.",
        args: {},
        async execute() {
          const root = resolveToolkitRoot()
          const state = await checkPluginUpdateNow(root)
          return jsonText({
            toolkit_root: root,
            update_manifest_url: resolveUpdateManifestSource(),
            update_repository: resolveUpdateRepository(),
            update_version_url: resolveUpdateVersionSource(),
            state,
          })
        },
      }),
      dbt_ensure_usbnet: tool({
        description: "Ensure the macOS USB ECM host interface is configured to the expected static IP.",
        args: {},
        async execute() {
          const target = await resolveConnectedMutationTarget("", "", "")
          return jsonText(await localAgentTool("ensure_usbnet", {
            board_id: target.board,
            variant_id: target.variant,
            device_id: target.device_id,
          }, { timeoutMs: 12000 }))
        },
      }),
      dbt_flash_image: tool({
        description: "Flash the current board with an installed factory or custom image through local dbt-agentd. Use this for TaishanPi initialization image flashing; it handles running/download-mode detection and delegates the actual flashing workflow to the installed runtime. Do not inspect dbtctl help or run shell flashing commands.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          image_source: tool.schema.string().optional(),
          scope: tool.schema.string().optional(),
          host_image_dir: tool.schema.string().optional(),
          mode: tool.schema.string().optional(),
          dry_run: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await runFlashImageJob(args, {
            timeoutMs: boolValue(args.dry_run) ? 60000 : 900000,
          }))
        },
      }),
      dbt_start_flash_image: tool({
        description: "Start an installed factory or custom image flashing job through local dbt-agentd and return immediately with job_id and initial progress. Use this for long real flashing operations so progress can be queried with dbt_get_job_status.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          image_source: tool.schema.string().optional(),
          scope: tool.schema.string().optional(),
          host_image_dir: tool.schema.string().optional(),
          mode: tool.schema.string().optional(),
          dry_run: tool.schema.string().optional(),
        },
        async execute(args) {
          return jsonText(await startFlashImageJob(args))
        },
      }),
      dbt_get_job_status: tool({
        description: "Query a local dbt-agentd long-running job by job_id. Use after dbt_start_flash_image to show current flashing progress, output_tail, terminal state, and failure summary.",
        args: {
          job_id: tool.schema.string(),
        },
        async execute(args) {
          return jsonText(await getAgentJobStatus(args.job_id))
        },
      }),
      dbt_update_logo: tool({
        description: "Use a local image file from the current workspace to replace the startup boot logo, rebuild boot/resource assets, and optionally flash the boot partition. For requests like '把图片 xxx 作为启动 logo 重新烧写到开发板', call this directly. If the user asks to reflash it to the board, set flash=true.",
        args: {
          device_id: tool.schema.string().optional(),
          logo_path: tool.schema.string(),
          kernel_logo_path: tool.schema.string().optional(),
          rotate: tool.schema.string().optional(),
          scale: tool.schema.string().optional(),
          dtb_name: tool.schema.string().optional(),
          flash: tool.schema.string().optional(),
        },
        async execute(args) {
          const logoPath = resolveWorkspacePath(args.logo_path)
          if (!logoPath) throw new Error("logo_path is required")
          if (!existsSync(logoPath)) throw new Error(`logo_path does not exist: ${logoPath}`)
          const kernelLogoPath = resolveWorkspacePath(args.kernel_logo_path)
          if (kernelLogoPath && !existsSync(kernelLogoPath)) {
            throw new Error(`kernel_logo_path does not exist: ${kernelLogoPath}`)
          }
          const target = await resolveConnectedMutationTarget("", "", args.device_id)
          return jsonText(await localAgentTool("update_logo", {
            board_id: target.board,
            variant_id: target.variant,
            device_id: asString(args.device_id) || target.device_id,
            logo_path: logoPath,
            kernel_logo_path: kernelLogoPath,
            rotate: asString(args.rotate),
            scale: asString(args.scale),
            dtb_name: asString(args.dtb_name),
            flash: boolValue(args.flash),
          }, { timeoutMs: 120000 }))
        },
      }),
      dbt_get_board_config: tool({
        description: "Get minimal board tooling config for compile, deploy, and generation tasks. Returns compact board metadata and, for RP2350 boards, the actual runtime/sdk/build root paths. Do not use for simple live status queries.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          probe_env: tool.schema.boolean().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          const payload = await localAgentTool("get_board_config", {
            board_id: resolved.board,
            variant_id: resolved.variant,
            probe_env: boolValue(args.probe_env),
          }, { timeoutMs: 12000 })
          return jsonText(summarizeBoardConfigPayload(payload, resolved.board, resolved.variant))
        },
      }),
      dbt_get_capability_context: tool({
        description: "Read the minimal implementation contract for the selected capability. Use after dbt_prepare_request and capability-summary inspection. Do not invent capability ids. For live CPU, DDR, temperature, memory, storage, WiFi, or Bluetooth queries, use probe tools instead.",
        args: {
          board: tool.schema.string().optional(),
          capability: tool.schema.string(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const capability = normalizeCapabilityAlias(args.capability)
          if (!capability) throw new Error("capability is required")
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          await assertCapabilityAvailable(resolved.board, resolved.variant, capability)
          const query = new URLSearchParams({
            board_id: resolved.board,
            variant_id: resolved.variant,
            capability_id: capability,
          }).toString()
          const local = await tryLocalAgentJSON(`/v1/context/capability?${query}`, { timeoutMs: 6000 })
          if (local) {
            const status = await getPluginStatus()
            const connectedBoard = asString(status.board_id)
            const connectedVariant = asString(status.variant_id)
            const connected = !!status.connected_device
            const sameBoard = connected && connectedBoard === resolved.board && (!resolved.variant || !connectedVariant || connectedVariant === resolved.variant)
            local.execution_availability = sameBoard
              ? {
                  connected_device: true,
                  connected_board_matches_request: true,
                  live_control_available: true,
                  note: `Live control and runtime probing are available for ${resolved.board}/${resolved.variant}.`,
                }
              : {
                  connected_device: connected,
                  connected_board_matches_request: false,
                  live_control_available: false,
                  note: connected
                    ? `A different board is currently connected (${connectedBoard || "unknown"}${connectedVariant ? `/${connectedVariant}` : ""}). You may answer capability and usage questions for ${resolved.board}/${resolved.variant}, but do not claim to perform live control, deployment, flashing, or runtime probing until that board is actually connected.`
                    : `No ${resolved.board}/${resolved.variant} device is currently connected. You may answer capability and usage questions, but do not claim to perform live control, deployment, flashing, or runtime probing until the board is connected.`,
                }
            local.operator_warning = local.execution_availability.live_control_available
              ? ""
              : local.execution_availability.note
            local.response_rules = [
              "Use capability context for board-specific guidance and implementation details.",
              "If live_control_available is false, explicitly include operator_warning in the final answer.",
            ]
            return jsonText(summarizeCapabilityContextPayload(local))
          }
          throw new Error("Local dbt-agentd capability context is unavailable. Restart dbt-agentd and try again.")
        },
      }),
      dbt_probe_chip_control: tool({
        description: "Probe live chip-control data such as DDR frequency, CPU frequency, temperature, memory, or storage. Preferred tool for real-time hardware values.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          target: tool.schema.string(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/chip-control/probe", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              target: asString(args.target),
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_get_cpu_frequency: tool({
        description: "Get the live current CPU frequency from the connected board. Prefer this for direct CPU frequency questions.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/chip-control/probe", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              target: "cpu_current_frequency",
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_get_ddr_frequency: tool({
        description: "Get the live current DDR frequency from the connected board. Prefer this for direct DDR frequency questions.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/chip-control/probe", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              target: "ddr_current_frequency",
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_get_camera_preview_command: tool({
        description: "Return the exact board-side GStreamer command for previewing the onboard camera on screen. Prefer this for camera preview or capture-display how-to requests instead of host bash.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const board = asString(args.board)
          const resolved = board
            ? await resolveBoardVariantIfConnected(board, args.variant)
            : await resolveConnectedBoard("", args.variant)
          await assertCapabilityAvailable(resolved.board, resolved.variant, "camera_display")
          const command =
            "gst-launch-1.0 v4l2src device=/dev/video0 ! video/x-raw,format=NV12,width=1920,height=1080,framerate=30/1 ! kmssink"
          return jsonText({
            ok: true,
            board_id: resolved.board,
            variant_id: resolved.variant,
            capability_id: "camera_display",
            command,
            summary_for_user: `可以直接在板子上运行这条命令预览摄像头画面：${command}`,
            note: "This command must run on the development board, not on the local macOS host.",
          })
        },
      }),
      dbt_get_cpu_temperature: tool({
        description: "Get the live current CPU or SoC temperature from the connected board. Prefer this for direct temperature questions.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/chip-control/probe", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              target: "soc_temperature",
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_probe_wifi_bluetooth: tool({
        description: "Probe live WiFi and Bluetooth module state or module/interface details. Preferred tool for current WiFi and Bluetooth checks.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          target: tool.schema.string(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/wifi-bluetooth/probe", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              target: asString(args.target),
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_connect_wifi: tool({
        description: "Write wpa_supplicant.conf on the current board, then reconfigure or start wpa_supplicant and reconnect to the requested WiFi network. Use this when the user explicitly asks to connect WiFi.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          ssid: tool.schema.string(),
          psk: tool.schema.string().optional(),
          key_mgmt: tool.schema.string().optional(),
          interface: tool.schema.string().optional(),
          config_path: tool.schema.string().optional(),
        },
        async execute(args) {
          const target = await resolveConnectedMutationTarget(args.board, args.variant, args.device_id)
          const payload = await localAgentJSON("/v1/tools/wifi-bluetooth/connect", {
            method: "POST",
            payload: {
              board_id: target.board,
              variant_id: target.variant,
              device_id: asString(args.device_id) || target.device_id,
              ssid: asString(args.ssid),
              psk: asString(args.psk),
              key_mgmt: asString(args.key_mgmt),
              interface: asString(args.interface),
              config_path: asString(args.config_path),
            },
            timeoutMs: 15000,
          })
          return jsonText(payload)
        },
      }),
      dbt_scan_wifi_networks: tool({
        description: "Run wpa_cli scan and return parsed WiFi scan results from the current board. If wpa_supplicant is not running but config exists, dbt-agentd will try to start it first.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          interface: tool.schema.string().optional(),
          config_path: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/wifi-bluetooth/scan", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              interface: asString(args.interface),
              config_path: asString(args.config_path),
            },
            timeoutMs: 15000,
          })
          return jsonText(payload)
        },
      }),
      dbt_scan_bluetooth_devices: tool({
        description: "Bring up hci0 if needed, inspect Bluetooth adapter information, and scan nearby Bluetooth devices.",
        args: {
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/tools/wifi-bluetooth/bluetooth-scan", {
            method: "POST",
            payload: {
              board_id: asString(args.board),
              variant_id: asString(args.variant),
            },
            timeoutMs: 15000,
          })
          return jsonText(payload)
        },
      }),
      dbt_build_run_program: tool({
        description: "Compile, upload, and run generated C/C++ source for a selected board capability. Normal flow: status -> prepare_request -> capability_summaries -> chosen capability context -> board config -> build_run_program. Do not invent hidden helper APIs.",
        args: {
          capability: tool.schema.string(),
          source: tool.schema.string(),
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          device_id: tool.schema.string().optional(),
          language: tool.schema.string().optional(),
          binary_name: tool.schema.string().optional(),
          remote_workdir: tool.schema.string().optional(),
          dry_run: tool.schema.string().optional(),
        },
        async execute(args) {
          const capability = asString(args.capability)
          const source = typeof args.source === "string" ? args.source : ""
          if (!capability) throw new Error("capability is required")
          if (!source.trim()) throw new Error("source is required")
          const target = await resolveConnectedMutationTarget(args.board, args.variant, args.device_id)
          await assertCapabilityAvailable(target.board, target.variant, capability)
          const language = asString(args.language) || "c"
          const local = reviewSourceFile(language, source, capability, args.binary_name)
          const binaryName = asString(args.binary_name) || local.base
          const result = await localAgentTool("build_run_program", {
            board_id: target.board,
            variant_id: target.variant,
            device_id: asString(args.device_id) || target.device_id,
            capability,
            source_file: local.file,
            language,
            binary_name: binaryName,
            remote_workdir: asString(args.remote_workdir),
            dry_run: boolValue(args.dry_run),
          }, { timeoutMs: 180000 })
          return jsonText(summarizeBuildRunPayload(result))
        },
      }),
      dbt_submit_insight_bundle: tool({
        description: "Store a standardized local insight bundle through dbt-agentd. The bundle stays on the local queue now; server upload is intentionally not enabled yet.",
        args: {
          title: tool.schema.string(),
          content_markdown: tool.schema.string(),
          source: tool.schema.string().optional(),
          board: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          capability: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/insights/submit", {
            method: "POST",
            payload: {
              source: asString(args.source) || "opencode",
              title: asString(args.title),
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              capability_id: asString(args.capability),
              content_markdown: asString(args.content_markdown),
              metadata: {
                source_client: "opencode_plugin",
              },
            },
            timeoutMs: 10000,
          })
          return jsonText(payload)
        },
      }),
      dbt_run_review_cycle: tool({
        description: "Run the local DBT knowledge review cycle and produce a pending review package from direct chat evidence or a stored evidence file. This stops at review generation and does not publish automatically.",
        args: {
          board: tool.schema.string(),
          variant: tool.schema.string(),
          capability: tool.schema.string(),
          title: tool.schema.string().optional(),
          evidence_text: tool.schema.string().optional(),
          evidence_path: tool.schema.string().optional(),
          model: tool.schema.string().optional(),
          strict: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/knowledge/review-cycle", {
            method: "POST",
            payload: {
              title: asString(args.title),
              evidence_text: asString(args.evidence_text),
              evidence_path: asString(args.evidence_path),
              board_id: asString(args.board),
              variant_id: asString(args.variant),
              capability_id: asString(args.capability),
              model: asString(args.model),
              strict: String(args.strict ?? "").trim().toLowerCase() !== "false",
            },
            timeoutMs: 120000,
          })
          return jsonText(payload)
        },
      }),
      dbt_publish_review_package: tool({
        description: "Publish an approved pending local DBT review package. Use this only after the user explicitly approves publication.",
        args: {
          review_manifest: tool.schema.string(),
          reload_agent: tool.schema.string().optional(),
        },
        async execute(args) {
          const payload = await localAgentJSON("/v1/knowledge/publish-review", {
            method: "POST",
            payload: {
              review_manifest: asString(args.review_manifest),
              reload_agent: String(args.reload_agent ?? "").trim().toLowerCase() === "true",
            },
            timeoutMs: 120000,
          })
          return jsonText(payload)
        },
      }),
      dbt_build_release_delta: tool({
        description: "Build the current local release delta from published knowledge and plugin changes through dbt-agentd.",
        args: {},
        async execute() {
          return jsonText(await localAgentJSON("/v1/knowledge/build-release-delta", {
            method: "POST",
            payload: {},
            timeoutMs: 120000,
          }))
        },
      }),
  }

  const dispatchTools = { ...tools }
  tools.dbttool = tool({
    description: "Gemini-safe DBT tool dispatcher. Use this for all Development Board Toolchain operations. Set action to one of: status, list-devices, flash-image, flash-start, job-status, prepare, capabilities, capability-summaries, capability-context, board-config, env-check, env-install, usbnet, update-logo, chip-probe, cpu-frequency, ddr-frequency, cpu-temperature, processes, wireless-probe, connect-wifi, scan-wifi, scan-bluetooth, build-run, check-plugin-update, update-plugin, rp2350-detect, rp2350-flash, rp2350-verify, rp2350-run, rp2350-logs, rp2350-build-flash. Put tool-specific arguments as a JSON object string in arguments_json.",
    args: {
      action: tool.schema.string(),
      request: tool.schema.string().optional(),
      arguments_json: tool.schema.string().optional(),
    },
    async execute(args) {
      const action = normalizeDispatchAction(args.action)
      const targetToolName = dispatchTargetToolName(action)
      const selected = targetToolName ? dispatchTools[targetToolName] : null
      if (!selected || typeof selected.execute !== "function") {
        return jsonText({
          ok: false,
          error_code: "unsupported_dispatch_action",
          error_message: `Unsupported DBT action: ${asString(args.action)}`,
          supported_actions: [
            "status",
            "list-devices",
            "flash-image",
            "flash-start",
            "job-status",
            "prepare",
            "capabilities",
            "capability-summaries",
            "capability-context",
            "board-config",
            "env-check",
            "env-install",
            "usbnet",
            "update-logo",
            "chip-probe",
            "cpu-frequency",
            "ddr-frequency",
            "cpu-temperature",
            "processes",
            "wireless-probe",
            "connect-wifi",
            "scan-wifi",
            "scan-bluetooth",
            "build-run",
            "check-plugin-update",
            "update-plugin",
            "rp2350-detect",
            "rp2350-flash",
            "rp2350-verify",
            "rp2350-run",
            "rp2350-logs",
            "rp2350-build-flash",
          ],
        })
      }
      const dispatchArgs = parseDispatchArguments(args)
      if (dispatchArgs.ok === false) return jsonText(dispatchArgs)
      return selected.execute(dispatchArgs)
    },
  })

  const aliasSpecs = [
    ["dbtlistdevices", "dbt_list_connected_devices", "List connected DBT development boards."],
    ["dbtflashimage", "dbt_flash_image", "Flash a factory or custom image through local dbt-agentd. For TaishanPi initialization, use arguments_json {\"image_source\":\"factory\",\"scope\":\"all\"}; add \"dry_run\":\"true\" only for validation without real flashing."],
    ["dbtflashstart", "dbt_start_flash_image", "Start a long factory or custom image flashing job and return job_id immediately for progress polling."],
    ["dbtjobstatus", "dbt_get_job_status", "Query a local dbt-agentd job by job_id and show progress, output tail, terminal state, or failure summary."],
    ["dbtprepare", "dbt_prepare_request", "Resolve a DBT board request before capability or execution planning."],
    ["dbtcapabilities", "dbt_get_board_capabilities", "Get capability summaries for the current or requested board."],
    ["dbtcapabilitysummaries", "dbt_list_capability_summaries", "List concise capability summaries for a board and variant."],
    ["dbtcapabilitycontext", "dbt_get_capability_context", "Get detailed capability implementation context."],
    ["dbtboardconfig", "dbt_get_board_config", "Get board and runtime configuration."],
    ["dbtenvcheck", "dbt_check_board_environment", "Check whether the board environment is installed and ready."],
    ["dbtenvinstall", "dbt_install_board_environment", "Install or repair a board environment through local dbt-agentd."],
    ["dbtusbnet", "dbt_ensure_usbnet", "Ensure host USB network configuration for the connected board."],
    ["dbtupdatelogo", "dbt_update_logo", "Update the board startup logo from a workspace image."],
    ["dbtchipprobe", "dbt_probe_chip_control", "Probe live chip-control data such as CPU, DDR, temperature, memory, or storage."],
    ["dbtcpufrequency", "dbt_get_cpu_frequency", "Get current CPU frequency."],
    ["dbtddrfrequency", "dbt_get_ddr_frequency", "Get current DDR frequency."],
    ["dbtcputemperature", "dbt_get_cpu_temperature", "Get current CPU or SoC temperature."],
    ["dbtprocesses", "dbt_list_board_processes", "List current Linux-board processes from the connected development board."],
    ["dbtwirelessprobe", "dbt_probe_wifi_bluetooth", "Probe WiFi or Bluetooth state."],
    ["dbtconnectwifi", "dbt_connect_wifi", "Connect the board to WiFi."],
    ["dbtwifiscan", "dbt_scan_wifi_networks", "Scan nearby WiFi networks."],
    ["dbtbluetoothscan", "dbt_scan_bluetooth_devices", "Scan nearby Bluetooth devices."],
    ["dbtbuildrun", "dbt_build_run_program", "Build, upload, and run generated C/C++ source for a selected capability."],
    ["dbtcheckpluginupdate", "dbt_check_plugin_update", "Check Development Board Toolchain update status."],
    ["dbtupdateplugin", "dbt_update_plugin", "Update the installed Development Board Toolchain OpenCode plugin/runtime."],
  ]
  for (const [aliasName, targetName, description] of aliasSpecs) {
    tools[aliasName] = tool({
      description,
      args: {
        request: tool.schema.string().optional(),
        arguments_json: tool.schema.string().optional(),
      },
      async execute(args) {
        const selected = dispatchTools[targetName]
        if (!selected || typeof selected.execute !== "function") {
          return jsonText({
            ok: false,
            error_code: "alias_target_missing",
            error_message: `Alias target not found: ${targetName}`,
          })
        }
        const dispatchArgs = parseDispatchArguments(args)
        if (dispatchArgs.ok === false) return jsonText(dispatchArgs)
        return selected.execute(dispatchArgs)
      },
    })
  }

  const retiredToolNames = new Set([
    "dbt_get_camera_preview_command",
    "dbt_submit_insight_bundle",
    "dbt_run_review_cycle",
    "dbt_publish_review_package",
    "dbt_build_release_delta",
  ])
  for (const name of retiredToolNames) {
    delete tools[name]
  }

  if (!advancedToolsEnabled()) {
    const defaultToolNames = defaultOpenCodeToolNames(connectedBoardForToolSurface)
    for (const name of Object.keys(tools)) {
      if (!defaultToolNames.has(name)) {
        delete tools[name]
      }
    }
  }

  return {
    tool: tools,
    "tool.definition": async (input, output) => {
      if (guidanceDisabled()) return
      if (input.toolID === "bash") {
        output.description =
          "Host bash runs only on the local macOS machine. Never use host bash for board-side commands, board status, GPIO, camera, WiFi, Bluetooth, flashing, or deployment when a DBT tool or capability context exists. For board operations, use DBT tools instead."
      }
      if (input.toolID === "dbttool") {
        output.description =
          "Use this dispatcher for all DBT operations with Gemini. Common actions: status for current board status; processes for Linux-board process lists; flash-image for blocking TaishanPi dry-run or short image flashing; flash-start plus job-status for long real flashing progress; env-check for environment preflight; board-config for board/runtime config; capabilities or capability-context for knowledge; chip-probe/cpu-frequency/ddr-frequency/cpu-temperature for live chip data; wireless-probe/scan-wifi/scan-bluetooth/connect-wifi for wireless workflows. Pass tool-specific arguments as a JSON object string in arguments_json."
      }
      if (input.toolID === "dbt_current_board_status") {
        output.description =
          "Use this for live board status, connection state, execution precheck, USB ECM, RP2350 single-USB state, SSH, or control-service questions. It already includes connected devices and the active device. If it returns ok=false or tool_error=true, explain summary_for_user directly to the user."
      }
      if (input.toolID === "dbt_list_connected_devices") {
        output.description =
          "Use this only when the user explicitly asks for a raw connected-device list or needs device_id values for manual multi-device targeting. Do not call it when dbt_current_board_status already answers the question."
      }
      if (input.toolID === "dbt_rp2350_detect") {
        output.description =
          "Use for RP2350-family state detection. This classifies the board as bootsel, runtime-resettable, or not-found."
      }
      if (input.toolID === "dbt_rp2350_set_board_model") {
        output.description =
          "Use this when the user is initializing an RP2350-family board for the first time and needs to bind the current device to ColorEasyPICO2 or RaspberryPiPico2W."
      }
      if (input.toolID === "dbt_rp2350_enter_bootsel") {
        output.description =
          "Use this only for RP2350-family single-USB BOOTSEL transitions. Do not use Linux reboot or loader tools for RP2350."
      }
      if (input.toolID === "dbt_rp2350_flash") {
        output.description =
          "Use this to flash a UF2 to an RP2350-family board. Pass a UF2 path from the current workspace. Do not use dbt_build_run_program for RP2350 boards."
      }
      if (input.toolID === "dbt_rp2350_verify") {
        output.description =
          "Use this to verify a UF2 on an RP2350-family board and wait for runtime recovery."
      }
      if (input.toolID === "dbt_rp2350_run") {
        output.description =
          "Use this to bring an RP2350-family board back to application runtime after BOOTSEL or verification transitions."
      }
      if (input.toolID === "dbt_rp2350_tail_logs") {
        output.description =
          "Use this to read recent serial logs from an RP2350-family board. Prefer this over host shell serial commands. After it returns, summarize summary_for_user or stdout_excerpt directly instead of truncating or rephrasing only the board name. Do not follow it with host bash, Explore Agent, /dev globbing, or any host-side serial inspection."
      }
      if (input.toolID === "dbt_rp2350_save_flash") {
        output.description =
          "Use this to read back RP2350-family flash into a UF2 file in the current workspace."
      }
      if (input.toolID === "dbt_rp2350_build_flash_source") {
        output.description =
          "Use this for RP2350-family code-generation and execution requests. First write self-contained Pico SDK C/C++ source that initializes USB stdio, then call this tool to build a UF2 and flash it. Do not use dbt_build_run_program for RP2350 boards."
      }
      if (input.toolID === "dbt_prepare_request") {
        output.description =
          "Use this to scope design, capability, generate, execute, flashing, or operator requests. For knowledge, capability, and how-to questions, call this directly without a prior status call when the target board is already explicit or implied. Reuse the resolved capability exactly. For design or generation, inspect capability summaries next."
      }
      if (input.toolID === "dbt_list_capability_summaries") {
        output.description =
          "Use after dbt_prepare_request. Choose the best capability from the summaries first, then fetch full context only for that capability."
      }
      if (input.toolID === "dbt_get_board_capabilities") {
        output.description =
          "Use this directly for capability-list questions about the current board or an explicitly named board. It resolves the current connected board automatically, so do not call dbt_current_board_status first unless runtime state or execution readiness is part of the question."
      }
      if (input.toolID === "dbt_get_capability_context") {
        output.description =
          "Use after capability-summary selection. Pass the exact selected capability id. Do not invent alternate names like led_control when the capability is rgb_led."
      }
      if (input.toolID === "dbt_probe_chip_control") {
        output.description =
          "For live CPU, DDR, temperature, memory, or storage questions, call this tool directly and answer from summary_for_user or the returned measured values."
      }
      if (input.toolID === "dbt_get_cpu_frequency") {
        output.description =
          "Use this for direct CPU frequency questions and answer from summary_for_user."
      }
      if (input.toolID === "dbt_get_ddr_frequency") {
        output.description =
          "Use this for direct DDR frequency questions and answer from summary_for_user."
      }
      if (input.toolID === "dbt_get_cpu_temperature") {
        output.description =
          "Use this for direct CPU or SoC temperature questions and answer from summary_for_user."
      }
      if (input.toolID === "dbt_list_board_processes" || input.toolID === "dbtprocesses") {
        output.description =
          "Use this for Linux-board process-list questions such as '当前开发板有哪些进程'. It returns structured process rows from the board through local dbt-agentd. Do not use host bash, SSH shell commands, or capability lookups for this."
      }
      if (input.toolID === "dbt_probe_wifi_bluetooth") {
        output.description =
          "For live WiFi or Bluetooth status questions, call this tool directly and answer from summary_for_user or the returned live probe fields."
      }
      if (input.toolID === "dbt_scan_wifi_networks") {
        output.description =
          "For nearby WiFi hotspot scan requests, call this tool directly and summarize the discovered SSIDs and signal information."
      }
      if (input.toolID === "dbt_scan_bluetooth_devices") {
        output.description =
          "For nearby Bluetooth scan requests, call this tool directly and summarize discovered devices or the adapter error."
      }
      if (input.toolID === "dbt_flash_image") {
        output.description =
          "Use this for TaishanPi or other supported Linux-board factory/custom image flashing and initialization-image burning. Default image_source=factory and scope=all unless the user specifies otherwise. Do not run dbtctl, dbtctl --help, host bash flashing commands, or project-tree binaries; dbt-agentd selects running/download mode and performs the installed-runtime flash workflow."
      }
      if (input.toolID === "dbt_start_flash_image" || input.toolID === "dbtflashstart") {
        output.description =
          "Use this to start a long real image flashing job without blocking the whole OpenCode turn. Return the job_id to the user, then call dbt_get_job_status or dbtjobstatus with that job_id to show progress."
      }
      if (input.toolID === "dbt_get_job_status" || input.toolID === "dbtjobstatus") {
        output.description =
          "Use this to poll a local dbt-agentd job by job_id. Summarize progress_percent, status_label, output_tail, terminal state, and failure_summary directly to the user."
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (guidanceDisabled()) return
      const visibleToolNames = Object.keys(tools)
      const aliasToolNames = geminiAliasToolNames()
      const aliasOnly = visibleToolNames.length > 0 && visibleToolNames.every((name) => aliasToolNames.has(name))
      if (aliasOnly) {
        output.system.push(
          "For Development Board Toolchain requests, call the DBT alias tools. Use dbtstatus for current board status, dbtflashimage for blocking dry-run or short TaishanPi factory/custom image flashing, dbtflashstart plus dbtjobstatus for long real flashing progress, dbtenvcheck for preflight, dbtboardconfig for config, dbtcapabilities or dbtcapabilitycontext for knowledge, dbtprocesses for Linux-board process lists, and dbtchipprobe/dbtcpufrequency/dbtddrfrequency/dbtcputemperature/dbtwirelessprobe/dbtwifiscan/dbtbluetoothscan for live probes.",
        )
        output.system.push(
          "For long real image flashing, prefer dbtflashstart with arguments_json {\"image_source\":\"factory\",\"scope\":\"all\"}, return the job_id, then call dbtjobstatus with that job_id to show current progress. Use dbtflashimage with {\"dry_run\":\"true\"} for validation without real flashing.",
        )
        output.system.push(
          "Do not run dbtctl, dbtctl --help, host bash flashing commands, or source-checkout DBT-Agent-Project/docker-project binaries for board operations. The local dbt-agentd runtime owns status, mode detection, flashing, probes, and tool events.",
        )
        return
      }
      output.system.push(
        "For Development Board Toolchain requests in OpenCode with Gemini, call the dbttool dispatcher instead of underscored DBT tool ids. Use action=status for current board status, action=processes for Linux-board process lists, action=flash-image for blocking dry-run or short TaishanPi image flashing, action=flash-start plus action=job-status for long real flashing progress, and pass extra arguments as JSON in arguments_json.",
      )
      output.system.push(
        "For live board status, connection, USB ECM, SSH, control-service, or execution-precheck questions, call dbttool with action=status first and answer from that result.",
      )
      output.system.push(
        "dbttool action=status already includes connected devices and the active device. Do not call action=list-devices unless the user explicitly needs raw device_id values or a dedicated connected-device list.",
      )
      output.system.push(
        "If multiple devices are connected and the user needs to target one specific device for a mutating action, only then use dbt_list_connected_devices to obtain exact device_id values.",
      )
      output.system.push(
        "For requests that ask which devices are currently connected, prefer dbttool action=status first because it already contains the device list. Only fall back to action=list-devices when the user explicitly asks for raw device ids.",
      )
      output.system.push(
        "If a DBT tool returns ok=false, tool_error=true, or summary_for_user that describes a failure or timeout, summarize that failure directly to the user in the same turn. Do not end with an empty reply.",
      )
      output.system.push(
        "Do not run board-specific shell commands through the host bash tool when a DBT tool or capability context can answer or execute the request. Board commands must go through DBT tools, not host bash.",
      )
      output.system.push(
        "For DBT-related requests, never finish with an empty response. Either call the appropriate DBT tool or ask one concise clarifying question.",
      )
      output.system.push(
        "ColorEasyPICO2 and RaspberryPiPico2W are RP2350-family single-USB microcontroller paths, not Linux boards. For RP2350 control actions use the dedicated RP2350 DBT tools directly, not dbt_build_run_program, SSH, USB ECM, or Linux capability workflows.",
      )
      output.system.push(
        "For RP2350-family code-generation or LED/GPIO firmware requests, write self-contained Pico SDK C/C++ source and then call dbt_rp2350_build_flash_source. Do not stop at a code block, and do not route RP2350 firmware builds through dbt_build_run_program.",
      )
      output.system.push(
        "When an RP2350 capability context includes implementation_contract.build_contract or implementation_contract.runtime_protocol_requirements, treat those fields as authoritative. Reuse the specified Pico SDK project layout, headers, libraries, compile definitions, board id, variant id, support headers, and DBT runtime protocol rules instead of inventing your own build scaffold.",
        "If implementation_contract.build_contract.capability_build_profiles contains an entry for the selected capability, inherit that entry's required_headers, required_include_directories, required_link_libraries, generated_support_headers, and notes before you write any RP2350 source.",
      )
      output.system.push(
        "For RP2350-family generated runtime firmware, preserve the DBT single-USB protocol: keep USB stdio initialized, emit a DBT_IDENTITY line that includes board and variant, and answer an IDENTITY command over USB CDC so the host can auto-identify the board model without relying on serial-number binding.",
        "Do not gate DBT_IDENTITY, DBT_READY, heartbeat output, or command polling behind stdio_usb_connected(); the RP2350 runtime protocol must remain responsive immediately after boot even if the host CDC connection state is not yet asserted.",
      )
      output.system.push(
        "For RaspberryPiPico2W generated firmware, do not invent ad-hoc header hacks inside main.c for lwipopts.h or btstack_config.h. If WiFi or BTstack support is needed, rely on the RP2350 project scaffold and its generated support headers instead of embedding fake header contents inline.",
      )
      output.system.push(
        "For RP2350 PIO code generated inline in C/C++, do not use `pio_program_t.wrap_target`, `pio_program_t.wrap_source`, or `pio_program_init()`. Build a small `uint16_t instructions[]` array, fill it with `pio_encode_*()` at runtime, create `pio_program_t { .instructions = instructions, .length = N, .origin = -1 }`, call `pio_add_program()`, use `pio_get_default_sm_config()`, set wrap with `sm_config_set_wrap()`, then use `pio_sm_init()` and `pio_sm_set_enabled()`.",
      )
      output.system.push(
        "Do not place `pio_encode_*()` calls inside `static const` initializers for RP2350 inline C/C++ programs. Treat them as runtime helpers, not compile-time constants.",
      )
      output.system.push(
        "For RP2350 TX-FIFO to RX-FIFO PIO echo self-tests, prefer this exact 4-instruction runtime sequence: `pio_encode_pull(false, true)`, `pio_encode_mov(pio_y, pio_osr)`, `pio_encode_mov(pio_isr, pio_y)`, `pio_encode_push(false, true)`. Do not replace it with a shorter `pull/mov/push` sequence and do not substitute `pio_encode_in/out` for this echo pattern.",
      )
      output.system.push(
        "For RP2350 multicore self-tests, prefer a simple deterministic pattern: core1 launched with `multicore_launch_core1()` sends a monotonically increasing counter through `multicore_fifo_push_blocking()`, and core0 logs `MULTICORE_OK rx=<n>` after `multicore_fifo_pop_blocking()`.",
      )
      output.system.push(
        "For generated RP2350 DBT runtime firmware, keep `DBT_IDENTITY board=<BoardID> variant=<BoardID>` aligned with the selected board model. Do not emit a generic variant like `rp2350-single-usb` when the selected board is `RaspberryPiPico2W` or `ColorEasyPICO2`.",
      )
      output.system.push(
        "If no board is connected and the user did not provide a board model, do not enumerate boards or capabilities. Ask for the board model or ask the user to connect the board first.",
      )
      output.system.push(
        "If the user names a board model but no device is connected, you may answer capability and usage questions, but say that live control and execution cannot run until the board is connected.",
      )
      output.system.push(
        "For board-specific knowledge, capability, and how-to questions, if the board is already explicit or clearly implied, call dbt_prepare_request directly. Do not call dbt_current_board_status first unless live execution, flashing, testing, or connection state matters.",
      )
      output.system.push(
        "When the user asks about the current board's capabilities, current board plus board-specific request text is enough to start with dbt_prepare_request. Do not insert a redundant status query before capability lookup.",
      )
      output.system.push(
        "For questions like '当前开发板有什么能力' or '这个开发板支持什么功能', call dbt_get_board_capabilities directly. Do not call dbt_current_board_status first unless the user is also asking about live connection or execution state.",
      )
      output.system.push(
        "For design and generation requests, after dbt_prepare_request, inspect capability summaries before fetching full capability context. Choose from summaries instead of inventing a capability name.",
      )
      output.system.push(
        "For guide or how-to requests, after capability summaries identify the best matching capability, fetch its capability context or answer from an obviously sufficient summary. Do not stop at the summary list.",
      )
      output.system.push(
        "After dbt_prepare_request, do not stop early. If should_stop is false, continue with the recommended_tools in the same turn until you have either selected a capability context or have enough facts to answer.",
      )
      output.system.push(
        "If the user asks to run, execute, deploy, burn, or flash something on the connected board, do not stop after drafting code or explaining the plan. Continue to the DBT execution tool that performs the action unless preflight or live availability blocks it.",
      )
      output.system.push(
        "For TaishanPi initialization-image burning or full-board image flashing, use dbt_start_flash_image with image_source=factory and scope=all for long real flashing so progress can be polled with dbt_get_job_status. Use dbt_flash_image only for blocking dry-run or when the user explicitly wants to wait for completion in one tool call. Do not call dbtctl --help, do not execute dbtctl through host bash, and do not use DBT-Agent-Project or docker-project development paths for board operations.",
      )
      output.system.push(
        "The OpenCode plugin is an installed-runtime client. Board control, flashing, status, and probes must go through local dbt-agentd and files under ~/Library/Application Support/development-board-toolchain, not source checkout paths.",
      )
      output.system.push(
        "For run or execute requests, do not end with a raw source code block unless the user explicitly asked for code only. If live execution is available, continue to dbt_build_run_program.",
      )
      output.system.push(
        "If dbt_build_run_program returns ok=false, do not stop silently. Summarize the failure from summary or stderr_excerpt, and only propose a fix if the error is clear.",
      )
      output.system.push(
        "If dbt_rp2350_build_flash_source fails, stop and summarize the concrete compiler or CMake error first. Do not keep rewriting the source or narrating multiple speculative fixes unless a new tool result confirms a specific next error.",
      )
      output.system.push(
        "For live CPU, DDR, temperature, memory, or storage questions, prefer dbt_probe_chip_control directly instead of broad planning or generic capability lookups.",
      )
      output.system.push(
        "For Linux-board process-list questions such as '当前开发板有哪些进程', prefer dbt_list_board_processes or dbttool action=processes. Do not answer these requests with host bash, SSH shell narration, or capability context.",
      )
      output.system.push(
        "For direct CPU frequency, DDR frequency, or CPU temperature questions, prefer the dedicated DBT chip-state tools before generic planning.",
      )
      output.system.push(
        "For live WiFi or Bluetooth state or scan questions, prefer dbt_probe_wifi_bluetooth, dbt_scan_wifi_networks, or dbt_scan_bluetooth_devices directly.",
      )
      output.system.push(
        "For board-specific how-to questions such as camera preview, GPIO usage, RTC operations, or interface testing, prefer dbt_prepare_request and DBT capability context instead of host filesystem or host bash tools.",
      )
      output.system.push(
        "For RP2350-family architecture knowledge such as dual-architecture, multicore, PIO, HSTX, GPIO25, WL_GPIO0, CYW43 WiFi, ADC, or pin-function questions, prefer dbt_prepare_request plus DBT capability summaries/context. Do not use webfetch first when DBT knowledge already exists.",
      )
      output.system.push(
        "For ColorEasyPICO2 / RP2350 requests such as detect, BOOTSEL, flash, verify, run, tail_logs, or save_flash, skip capability-summary planning and call the RP2350 DBT tools directly after status if the request is operational.",
      )
      output.system.push(
        "For ColorEasyPICO2 serial-log requests, call dbt_rp2350_tail_logs directly and summarize the returned log lines from stdout_excerpt or summary_for_user instead of stopping at the tool result.",
      )
      output.system.push(
        "After dbt_rp2350_tail_logs or dbt_rp2350_build_flash_source returns, do not invoke host bash, Explore Agent, or host filesystem probes against /dev/* to inspect serial devices. Those DBT tools are already the authoritative execution and log path.",
      )
      output.system.push(
        "If an RP2350 build requires WiFi, wireless LED, or BTstack on RaspberryPiPico2W, first inherit the wifi_bluetooth capability_build_profiles entry, then choose the matching feature_build_profiles entry from implementation_contract.build_contract and reuse its exact headers, include directories, generated support headers, and libraries. Do not improvise alternate library sets.",
      )
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const latest = output.messages[output.messages.length - 1]
      if (latest?.info?.role === "user" && Array.isArray(latest.parts)) {
        latest.parts = latest.parts.map((part) => {
          if (part?.type !== "text" || typeof part.text !== "string") return part
          return {
            ...part,
            text: normalizeUserDBTText(part.text),
          }
        })
      }
    },
  }
}

DevelopmentBoardToolchainPlugin.id = "DBT-Agent"
DevelopmentBoardToolchainPlugin.displayName = "DBT-Agent"
DevelopmentBoardToolchainPlugin.pluginInfo = pluginInfo

export default {
  id: "DBT-Agent",
  displayName: "DBT-Agent",
  description: "development-board-toolchain board control, capability planning, flashing, and environment tooling for OpenCode.",
  server: DevelopmentBoardToolchainPlugin,
}
