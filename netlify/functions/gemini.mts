import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({})

export default async (req: Request) => {
  try {
    const { prompt, systemInstruction } = await req.json()

    if (!prompt || !systemInstruction) {
      return Response.json({ error: 'Missing prompt or systemInstruction' }, { status: 400 })
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    })

    return Response.json({ text: response.text })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Gemini API error:', message)
    return Response.json({ error: message }, { status: 502 })
  }
}

export const config = {
  path: '/api/gemini',
  method: 'POST',
}
