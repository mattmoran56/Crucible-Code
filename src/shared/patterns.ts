// Patterns that indicate Claude Code (or other CLI tools) need user intervention
export const INTERVENTION_PATTERNS = [
  /Do you want to proceed\?/i,
  /\(y\/n\)/i,
  /\[Y\/n\]/,
  /\[yes\/no\]/i,
  /Are you sure\?/i,
  /Press Enter to continue/i,
  /Allow once|Allow always|Deny/,
  /Do you want to allow/i,
]
