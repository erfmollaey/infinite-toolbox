/**
 * Secret redaction utility to ensure credentials and secret values
 * are never leaked in logs, error messages, or tool outputs.
 * 
 * WARNING: Heuristic redaction cannot guarantee detection of every secret.
 * Prefer excluding sensitive files over relying only on regex-based detection.
 * Never log unredacted exception messages from untrusted data.
 */

const SECRET_PATTERNS = [
  // AWS / Cloud Keys (Access Key IDs)
  /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
  // Generic API Keys, Bearer tokens, and secret assignments
  /(?:api[_-]?key|secret|token|password|auth|passwd|client[_-]?secret)\s*[:=]\s*["']?([^\s"';]{8,})["']?/gi,
  // OpenAI / Anthropic / AI API Keys (sk- prefix)
  /sk-(?:proj-|admin-|[^\s]{1})[a-zA-Z0-9_-]{20,}/g,
  // GitHub Personal Access Tokens
  /gh[pousr]_[a-zA-Z0-9]{36,}/g,
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
  // Private Key Headers (PEM format)
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  // Connection Strings with embedded credentials
  /[a-zA-Z0-9+.-]+:\/\/[^:]+:([^@\s]{1,128})@[^\s]+/g,
  // JWT tokens
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  // Generic bearer token patterns
  /bearer\s+[a-zA-Z0-9\-_+]{40,}/gi,
  // Database connection strings with passwords
  /postgres(?:\/\/|s)([^@\s]{1,64}):([^@\s]{1,128})@/g,
  /mysql(?:\/\/|s)([^@\s]{1,64}):([^@\s]{1,128})@/g,
  /mssql(?:\/\/|s)([^@\s]{1,64}):([^@\s]{1,128})@/g,
  / oracle(?:\/\/|s)([^@\s]{1,64}):([^@\s]{1,128})@/g,
];

/**
 * Redacts known secret patterns from text.
 * Prioritizes private key redaction, then key=value patterns, then known token patterns.
 * 
 * @param text - The text to redact secrets from
 * @returns Text with known secret patterns replaced by [REDACTED] markers
 * 
 * @note Heuristic redaction cannot guarantee detection of every secret.
 *       Prefer excluding sensitive files over relying only on regex.
 *       Does not log unredacted exception messages from untrusted data.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let redacted = text;

  // Redact private keys first (most sensitive)
  redacted = redacted.replace(
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]'
  );

  // Redact key=value or key: value secrets
  // The _val parameter captures the actual value which is immediately replaced
  // This prevents any secret value from appearing in output
  redacted = redacted.replace(
    /(?:api[_-]?key|secret|token|password|auth|passwd|client[_-]?secret)\s*([:=])\s*(["']?)([^\s"';]{4,})\2/gi,
    (match, separator, quote, _val) => {
      const keyPart = match.substring(0, match.indexOf(separator) + 1);
      return `${keyPart} ${quote}[REDACTED]${quote}`;
    }
  );

  // Redact known token patterns (AWS, GitHub, JWT, etc.)
  for (const pattern of SECRET_PATTERNS) {
    // Skip patterns already handled above (private key and api[_-]?key)
    if (pattern.source.includes('PRIVATE KEY')) {
      continue; // already handled
    }
    if (pattern.source.includes('api[_-]?key') && pattern !== SECRET_PATTERNS[1]) {
      continue; // already handled by the key=value redaction above
    }
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
  }

  return redacted;
}

/**
 * Checks if a key name suggests it contains sensitive credential data.
 * 
 * @note This is a heuristic check only. Do not rely on it as a sole
 *       mechanism for secret protection. Always exclude sensitive files
 *       from output rather than relying on key name detection.
 */
export function isSensitiveKeyName(keyName: string): boolean {
  const normalized = keyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sensitiveKeywords = [
    'secret',
    'password',
    'passwd',
    'token',
    'apikey',
    'private',
    'credential',
    'auth',
    'session',
    'cookie',
    'signature',
    'salt',
    'cert',
    'key'
  ];
  return sensitiveKeywords.some((kw) => normalized.includes(kw));
}

/**
 * Ensures redaction is applied to log messages before writing to stderr.
 * Should be wrapped around any diagnostic output from untrusted sources.
 */
export function safeLog(message: string): string {
  return redactSecrets(message);
}
