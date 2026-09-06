declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>
  export default pdfParse
}

declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>
  const mammoth: { extractRawText: typeof extractRawText }
  export default mammoth
}
