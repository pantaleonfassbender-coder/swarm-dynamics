import pdf from 'pdf-parse'
import mammoth from 'mammoth'

export default async (req: Request) => {
  try {
    const { fileName, fileData } = await req.json()

    if (!fileName || !fileData) {
      return Response.json({ error: 'Missing fileName or fileData' }, { status: 400 })
    }

    const buffer = Buffer.from(fileData, 'base64')
    const ext = fileName.split('.').pop()?.toLowerCase()

    let text = ''

    if (ext === 'pdf') {
      const data = await pdf(buffer)
      text = data.text
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (ext === 'doc') {
      return Response.json(
        { error: 'Legacy .doc format is not supported. Please convert to .docx.' },
        { status: 400 },
      )
    } else {
      return Response.json({ error: `Unsupported file type: .${ext}` }, { status: 400 })
    }

    if (!text.trim()) {
      return Response.json(
        { text: '', warning: 'No text content could be extracted from the document.' },
      )
    }

    return Response.json({ text })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Document parse error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config = {
  path: '/api/parse-document',
  method: 'POST',
}
