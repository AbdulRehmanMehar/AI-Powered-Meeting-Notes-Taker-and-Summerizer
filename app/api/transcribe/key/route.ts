import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = 'a'//process.env.DEEPGRAM_API_KEY?.trim();

  if (!apiKey) {
    // Return mock mode flag if no API key
    return NextResponse.json({
      apiKey: null,
      useMock: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({
    apiKey: apiKey,
    useMock: false,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
