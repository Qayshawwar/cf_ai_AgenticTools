import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs
} from "ai";
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 8_000;

const DEFAULT_GREENHOUSE_BOARDS = [
  { token: "cloudflare", company: "Cloudflare" },
  { token: "stripe", company: "Stripe" },
  { token: "notion", company: "Notion" }
];

const DEFAULT_ASHBY_BOARDS = [
  { token: "openai", company: "OpenAI" },
  { token: "anthropic", company: "Anthropic" },
  { token: "airwallex", company: "Airwallex" }
];

type JobListing = {
  title: string;
  company: string;
  location: string;
  source: string;
  link: string;
  summary?: string;
  employmentType?: string;
};

type JobBoard = {
  token: string;
  company: string;
};

type ProviderResult = {
  jobs: JobListing[];
  error?: string;
};

type GreenhouseJob = {
  title?: string;
  content?: string;
  absolute_url?: string;
  location?: { name?: string };
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
};

type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  jobUrl?: string;
  jobPostUrl?: string;
  applicationUrl?: string;
  descriptionHtml?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  isRemote?: boolean;
};

type AshbyResponse = {
  jobs?: AshbyJob[];
};

type OpenAlexWork = {
  id?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
  };
  ids?: { doi?: string };
  abstract_inverted_index?: Record<string, number[]>;
};

type OpenAlexResponse = {
  results?: OpenAlexWork[];
};

function sanitizeBoardToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(jobs\.ashbyhq\.com\/|job-boards\.greenhouse\.io\/)/, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function cleanText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function matchesTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) => text.includes(token));
}

function buildSearchTokens(input: {
  query?: string;
  title?: string;
  keywords?: string;
  employmentType?: string;
}): string[] {
  return tokenize(
    [input.query, input.title, input.keywords, input.employmentType]
      .filter(Boolean)
      .join(" ")
  );
}

function matchesJobFilters(
  job: JobListing,
  filters: {
    tokens: string[];
    location?: string;
    company?: string;
    employmentType?: string;
  }
): boolean {
  const searchable = cleanText(
    `${job.title} ${job.company} ${job.location} ${job.summary ?? ""} ${job.employmentType ?? ""}`
  );

  if (!matchesTokens(searchable, filters.tokens)) {
    return false;
  }

  if (filters.location) {
    const wantedLocation = cleanText(filters.location);
    if (!cleanText(job.location).includes(wantedLocation)) {
      return false;
    }
  }

  if (filters.company) {
    const wantedCompany = cleanText(filters.company);
    if (!cleanText(job.company).includes(wantedCompany)) {
      return false;
    }
  }

  if (filters.employmentType) {
    const wantedType = cleanText(filters.employmentType);
    if (!cleanText(job.employmentType).includes(wantedType)) {
      return false;
    }
  }

  return true;
}

function uniqueJobs(jobs: JobListing[]): JobListing[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.source}|${job.link}|${job.title}|${job.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function htmlToPlainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGreenhouseBoard(board: JobBoard): Promise<ProviderResult> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`;

  try {
    const payload = await fetchJson<GreenhouseResponse>(url);
    const jobs: JobListing[] = (payload.jobs ?? []).map((job) => ({
      title: job.title ?? "Untitled role",
      company: board.company,
      location: job.location?.name ?? "Location not listed",
      source: "Greenhouse",
      link: job.absolute_url ?? `https://job-boards.greenhouse.io/${board.token}`,
      summary: job.content ? htmlToPlainText(job.content).slice(0, 240) : undefined
    }));

    return { jobs };
  } catch (error) {
    return { jobs: [], error: `Greenhouse (${board.token}): ${String(error)}` };
  }
}

function ashbyJobLink(job: AshbyJob, boardToken: string): string {
  return (
    job.jobUrl ??
    job.jobPostUrl ??
    job.applicationUrl ??
    (job.id
      ? `https://jobs.ashbyhq.com/${boardToken}/${job.id}`
      : `https://jobs.ashbyhq.com/${boardToken}`)
  );
}

async function fetchAshbyBoard(board: JobBoard): Promise<ProviderResult> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${board.token}?includeCompensation=false`;

  try {
    const payload = await fetchJson<AshbyResponse>(url);
    const jobs: JobListing[] = (payload.jobs ?? []).map((job) => ({
      title: job.title ?? "Untitled role",
      company: board.company,
      location: job.location ?? (job.isRemote ? "Remote" : "Location not listed"),
      source: "Ashby",
      link: ashbyJobLink(job, board.token),
      summary: job.descriptionHtml
        ? htmlToPlainText(job.descriptionHtml).slice(0, 240)
        : [job.department, job.team].filter(Boolean).join(" - "),
      employmentType: job.employmentType
    }));

    return { jobs };
  } catch (error) {
    return { jobs: [], error: `Ashby (${board.token}): ${String(error)}` };
  }
}

function openAlexAbstractSnippet(index?: Record<string, number[]>): string | null {
  if (!index) return null;

  const orderedWords = Object.entries(index)
    .flatMap(([word, positions]) =>
      positions.map((position) => ({ word, position }))
    )
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.word);

  if (orderedWords.length === 0) return null;

  const text = orderedWords.join(" ");
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

export class ChatAgent extends AIChatAgent<Env> {
  // Wait for MCP connections to restore after hibernation before processing messages
  waitForMcpConnections = true;

  onStart() {
    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async addServer(name: string, url: string, host: string) {
    return await this.addMcpServer(name, url, { callbackHost: host });
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({ binding: this.env.AI });
    const isConversationStart = !this.messages.some(
      (message) => message.role === "assistant"
    );

    const result = streamText({
      model: workersai("@cf/zai-org/glm-4.7-flash"),
      system: `You are a concise conversational assistant with two built-in capabilities:
- job finding
- academic research using OpenAlex

Use tools when user requests match those capabilities. Do not invent tool results. If a tool fails or has no results, say so briefly and give a helpful next step. Ask a short follow-up question only when required to run a tool.

If the user asks for something outside those tools, still respond conversationally.
${isConversationStart ? "In your first response in this conversation, briefly mention you can help with job finding and academic research." : ""}`,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // MCP tools from connected servers
        ...mcpTools,

        findJobs: tool({
          description:
            "Find relevant job postings from public job boards (Greenhouse and Ashby).",
          inputSchema: z.object({
            query: z.string().optional().describe("General role query"),
            title: z.string().optional().describe("Job title"),
            keywords: z.string().optional().describe("Extra keyword filters"),
            location: z.string().optional().describe("Preferred location"),
            company: z
              .string()
              .optional()
              .describe("Company name or board token slug"),
            employmentType: z
              .enum(["internship", "full-time", "part-time", "contract"])
              .optional()
              .describe("Optional role type"),
            limit: z.number().int().min(1).max(8).default(5)
          }),
          execute: async ({
            query,
            title,
            keywords,
            location,
            company,
            employmentType,
            limit
          }) => {
            const hasSearchInput =
              Boolean(query?.trim()) ||
              Boolean(title?.trim()) ||
              Boolean(keywords?.trim()) ||
              Boolean(company?.trim());

            if (!hasSearchInput) {
              return {
                ok: false,
                message:
                  "Please provide at least a query, title, keywords, or company."
              };
            }

            const cleanCompany = company?.trim();
            const requestedToken = cleanCompany
              ? sanitizeBoardToken(cleanCompany)
              : null;

            if (cleanCompany && !requestedToken) {
              return {
                ok: false,
                message:
                  "I could not parse the company board token. Please try a simpler company name or board slug."
              };
            }

            const requestedBoards =
              cleanCompany && requestedToken
                ? [{ token: requestedToken, company: cleanCompany }]
                : undefined;

            const greenhouseBoards = requestedBoards ?? DEFAULT_GREENHOUSE_BOARDS;
            const ashbyBoards = requestedBoards ?? DEFAULT_ASHBY_BOARDS;

            const [greenhouseResults, ashbyResults] = await Promise.all([
              Promise.all(
                greenhouseBoards.map((board) => fetchGreenhouseBoard(board))
              ),
              Promise.all(ashbyBoards.map((board) => fetchAshbyBoard(board)))
            ]);

            const providerErrors = [...greenhouseResults, ...ashbyResults]
              .flatMap((result) => (result.error ? [result.error] : []))
              .slice(0, 6);

            const tokens = buildSearchTokens({
              query,
              title,
              keywords,
              employmentType
            });

            const filtered = uniqueJobs([
              ...greenhouseResults.flatMap((result) => result.jobs),
              ...ashbyResults.flatMap((result) => result.jobs)
            ])
              .filter((job) =>
                matchesJobFilters(job, {
                  tokens,
                  location,
                  company: cleanCompany,
                  employmentType
                })
              )
              .slice(0, limit);

            if (filtered.length === 0) {
              return {
                ok: false,
                message:
                  "No matching jobs were found from the configured public boards.",
                searchedSources: ["Greenhouse", "Ashby"],
                providerErrors
              };
            }

            return {
              ok: true,
              count: filtered.length,
              searchedSources: ["Greenhouse", "Ashby"],
              providerErrors,
              jobs: filtered.map((job) => ({
                title: job.title,
                company: job.company,
                location: job.location,
                source: job.source,
                link: job.link
              }))
            };
          }
        }),

        searchResearch: tool({
          description:
            "Search OpenAlex for academic works and return concise, structured results.",
          inputSchema: z.object({
            query: z.string().min(2).describe("Research topic or question"),
            limit: z.number().int().min(1).max(8).default(5)
          }),
          execute: async ({ query, limit }) => {
            const envWithOptionalKey = this.env as Env & {
              OPENALEX_API_KEY?: string;
            };
            const apiKey = envWithOptionalKey.OPENALEX_API_KEY?.trim();

            try {
              const params = new URLSearchParams({
                search: query,
                sort: "relevance_score:desc",
                "per-page": String(limit)
              });

              if (apiKey) {
                params.set("api_key", apiKey);
              }

              const response = await fetchJson<OpenAlexResponse>(
                `https://api.openalex.org/works?${params.toString()}`
              );

              const results = (response.results ?? []).slice(0, limit);
              if (results.length === 0) {
                return {
                  ok: false,
                  message: `No OpenAlex works found for "${query}".`,
                  usingApiKey: Boolean(apiKey)
                };
              }

              return {
                ok: true,
                count: results.length,
                usingApiKey: Boolean(apiKey),
                note: apiKey
                  ? undefined
                  : "OPENALEX_API_KEY is not set. Using unauthenticated OpenAlex access.",
                works: results.map((work) => ({
                  title: work.display_name ?? "Untitled work",
                  authors: (work.authorships ?? [])
                    .map((authorship) => authorship.author?.display_name)
                    .filter((name): name is string => Boolean(name))
                    .slice(0, 5),
                  year: work.publication_year ?? null,
                  source:
                    work.primary_location?.source?.display_name ??
                    "Source not listed",
                  url:
                    work.primary_location?.landing_page_url ??
                    work.ids?.doi ??
                    work.id ??
                    null,
                  summary: openAlexAbstractSnippet(work.abstract_inverted_index)
                }))
              };
            } catch (error) {
              return {
                ok: false,
                message:
                  "OpenAlex search failed. Please try again in a moment or narrow the query.",
                error: String(error),
                usingApiKey: Boolean(apiKey)
              };
            }
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
