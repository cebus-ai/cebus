/**
 * LangGraph Studio Entry Point
 *
 * Exports a compiled StateGraph for use with LangGraph Studio (`npx @langchain/langgraph-cli dev`).
 * Uses a demo TeamConfig with agents configured via environment variables.
 *
 * Environment variables:
 *   OPENAI_API_KEY   — enables the "gpt" agent (OpenAI GPT-4o)
 *   ANTHROPIC_API_KEY — enables the "claude" agent (Claude Sonnet 4.5)
 *   GOOGLE_API_KEY   — enables the "gemini" agent (Gemini 2.5 Flash)
 *
 * At least one API key must be set. If none are set, falls back to Ollama (local).
 */

import { compileGraph } from './graph.js';
import type { TeamConfig, AgentProfile } from './types.js';

function buildStudioConfig(): TeamConfig {
  const agents: AgentProfile[] = [];

  if (process.env['OPENAI_API_KEY'] !== undefined && process.env['OPENAI_API_KEY'].length > 0) {
    agents.push({
      id: 'gpt',
      name: 'GPT-4o',
      role: 'General-purpose assistant',
      instructions: ['You are GPT-4o, a helpful AI assistant.'],
      model: 'gpt-4o',
      provider: { type: 'openai', apiKey: process.env['OPENAI_API_KEY'] },
    });
  }

  if (
    process.env['ANTHROPIC_API_KEY'] !== undefined &&
    process.env['ANTHROPIC_API_KEY'].length > 0
  ) {
    agents.push({
      id: 'claude',
      name: 'Claude Sonnet',
      role: 'Thoughtful analyst',
      instructions: ['You are Claude, a thoughtful and careful AI assistant.'],
      model: 'claude-sonnet-4-5-20250929',
      provider: {
        type: 'anthropic',
        apiKey: process.env['ANTHROPIC_API_KEY'],
      },
    });
  }

  if (process.env['GOOGLE_API_KEY'] !== undefined && process.env['GOOGLE_API_KEY'].length > 0) {
    agents.push({
      id: 'gemini',
      name: 'Gemini Flash',
      role: 'Fast responder',
      instructions: ['You are Gemini, a fast and capable AI assistant.'],
      model: 'gemini-2.5-flash',
      provider: { type: 'gemini', apiKey: process.env['GOOGLE_API_KEY'] },
    });
  }

  // Fallback: Ollama local if no cloud keys set
  if (agents.length === 0) {
    agents.push({
      id: 'ollama',
      name: 'Ollama Local',
      role: 'Local assistant',
      instructions: ['You are a helpful local AI assistant.'],
      model: 'llama3.2',
      provider: {
        type: 'ollama',
        baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
      },
    });
  }

  return {
    teamId: 'studio-demo',
    mission: 'LangGraph Studio demo team for Cebus',
    orchestrationMode: 'deterministic',
    conversationMode: agents.length > 1 ? 'sequential' : 'tag_only',
    agents,
    defaultAgentId: agents[0]!.id,
  };
}

const config = buildStudioConfig();
const result = await compileGraph(config);

/** Compiled StateGraph — consumed by LangGraph Studio via langgraph.json */
export const graph = result.graph;
