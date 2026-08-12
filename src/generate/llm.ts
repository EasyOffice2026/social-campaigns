/** Minimal text-completion contract, so the model provider stays swappable. */
export interface TextGenerator {
  readonly name: string;
  complete(prompt: string, system: string): Promise<string>;
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

interface HttpOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}

export class AnthropicGenerator implements TextGenerator {
  readonly name = 'anthropic';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(prompt: string, system: string): Promise<string> {
    const response = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? 8000,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new GenerationError(
        `anthropic ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (text === '') throw new GenerationError('anthropic returned no text');
    return text;
  }
}

export class OpenAIGenerator implements TextGenerator {
  readonly name = 'openai';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(prompt: string, system: string): Promise<string> {
    const response = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new GenerationError(
        `openai ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    if (text === '') throw new GenerationError('openai returned no text');
    return text;
  }
}
