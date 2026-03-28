# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest `main` branch | :white_check_mark: |
| Other branches | :x: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use [GitHub's Private Vulnerability Reporting](https://github.com/Takenori-Kusaka/ganbari-quest/security/advisories/new) feature.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Initial response**: within 48 hours
- **Status update**: within 7 days
- **Fix release**: as soon as reasonably possible

### Scope

This project handles children's activity data. We take the following especially seriously:

- Authentication/authorization bypass
- Data exposure or leakage
- Cross-site scripting (XSS)
- Injection vulnerabilities (SQL, command, etc.)

### Out of scope

- Denial of Service attacks
- Issues requiring physical access to the device
- LAN-mode access control (local mode is designed to be accessible within the home network without authentication for child users)
- Social engineering

## License

This project is licensed under AGPL-3.0. Security fixes may be applied as patch releases.
