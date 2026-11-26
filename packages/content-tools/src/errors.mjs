export class ContentImportError extends Error {
  constructor(message, { code = 'CONTENT_IMPORT_FAILED', details, cause } = {}) {
    super(message, { cause })
    this.name = 'ContentImportError'
    this.code = code
    this.details = details
  }
}

export class ContentInspectionError extends Error {
  constructor(report) {
    super(`Content inspection failed: ${report.blockers.map(item => item.code).join(', ')}`)
    this.name = 'ContentInspectionError'
    this.code = 'CONTENT_INSPECTION_BLOCKED'
    this.report = report
  }
}
