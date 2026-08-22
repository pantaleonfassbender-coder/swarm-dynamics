import pdf from 'pdf-parse'
import mammoth from 'mammoth'

export default async (req: Request) => {
  try {
    const { fileName, fileData } = await req.json()

    if (!fileName || !fileData) {
      return Response.json({ error: 'Missing fileName or fileData' }, { status: 400 })
    }

    // Ohne Obergrenze laesst sich die Function mit einem grossen base64-Blob
    // in den Speicher treiben; base64 traegt rund 4/3 der Rohgroesse.
    const MAX_BYTES = 8 * 1024 * 1024
    if (typeof fileData !== 'string' || fileData.length > MAX_BYTES * 1.4) {
      return Response.json({ error: 'That file is larger than 8 MB.' }, { status: 413 })
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
  // Dokumentenextraktion ist teuer und der Endpunkt steht offen im Netz.
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: ['ip', 'domain'] },
}
