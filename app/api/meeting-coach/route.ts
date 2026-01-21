import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { transcript } = await request.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      // Return mock data if no API key is configured
      console.log('No OPENAI_API_KEY found, returning mock data');
      return NextResponse.json({
        keyPoints: [
          'Meeting discussed project timeline and deliverables',
          'Team agreed on weekly check-ins',
          'Budget constraints were addressed',
        ],
        actionItems: [
          'Send follow-up email with meeting notes',
          'Schedule next review session',
          'Prepare demo for stakeholders',
        ],
        coachingInsights: [
          'Consider asking more open-ended questions to encourage participation',
          'Good job summarizing key points at the end',
          'Try to keep interruptions minimal for better flow',
        ],
      });
    }

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an AI meeting coach. Analyze the meeting transcript and provide:
1. Key Points: The most important topics discussed (3-5 bullet points)
2. Action Items: Tasks that were assigned or need follow-up (3-5 items)
3. Coaching Insights: Feedback on communication, meeting effectiveness, and suggestions for improvement (3-5 insights)

Respond in JSON format:
{
  "keyPoints": ["point 1", "point 2", ...],
  "actionItems": ["item 1", "item 2", ...],
  "coachingInsights": ["insight 1", "insight 2", ...]
}`,
          },
          {
            role: 'user',
            content: `Meeting Transcript:\n\n${transcript}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      throw new Error('Failed to process with AI');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);

    return NextResponse.json({
      keyPoints: parsed.keyPoints || [],
      actionItems: parsed.actionItems || [],
      coachingInsights: parsed.coachingInsights || [],
    });

  } catch (error) {
    console.error('Meeting coach error:', error);
    return NextResponse.json(
      { error: 'Failed to process meeting transcript' },
      { status: 500 }
    );
  }
}
