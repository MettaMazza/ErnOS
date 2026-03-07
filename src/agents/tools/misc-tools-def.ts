import { Type } from "@sinclair/typebox";
import { homeAssistant } from "../../integrations/home-assistant.js";
import { stt } from "../../stt/stt.js";
import { reasoningTraces } from "../reasoning-trace.js";
import { documentBuilder } from "./document-builder.js";
import { documentGenerator } from "./pdf-generator.js";
import { rssFeeds } from "./rss-feeds.js";

export const createMiscTools = (userId: string) => {
  return [
    {
      name: "document_start",
      label: "Start Document",
      description: "Start building a new multi-step markdown document.",
      parameters: Type.Object({ title: Type.String() }),
      execute: async (args: any) => documentBuilder.startDocument(args.title),
    },
    {
      name: "document_add_section",
      label: "Add Document Section",
      description: "Add a section to an ongoing document.",
      parameters: Type.Object({
        docId: Type.String(),
        sectionTitle: Type.String(),
        content: Type.String(),
      }),
      execute: async (args: any) =>
        documentBuilder.addSection(args.docId, args.sectionTitle, args.content),
    },
    {
      name: "document_render_pdf",
      label: "Render PDF",
      description: "Compiles the document manifest into a styled PDF.",
      parameters: Type.Object({
        docId: Type.String(),
        theme: Type.Optional(
          Type.Unsafe<string>({
            type: "string",
            enum: ["Professional", "Minimal", "Cyberpunk", "Dark", "Pastel", "Elegant"],
          }),
        ),
      }),
      execute: async (args: any) => {
        const markdown = documentBuilder.renderDocument(args.docId);
        if (markdown.startsWith("Error:")) {return markdown;}
        return documentGenerator.generatePdf({
          content: markdown,
          title: `Document_${args.docId}`,
          theme: args.theme,
        });
      },
    },
    {
      name: "rss_get_news",
      label: "Get RSS News",
      description: "Fetch the latest global headlines from predefined RSS feeds.",
      parameters: Type.Object({}),
      execute: async () => rssFeeds.getLatestNews(),
    },
    {
      name: "stt_transcribe",
      label: "Transcribe Audio",
      description: "Transcribes a base64 audio block using Whisper STT.",
      parameters: Type.Object({
        audioBase64: Type.String(),
        language: Type.Optional(Type.String({ default: "en" })),
      }),
      execute: async (args: any) => stt.transcribe(args.audioBase64, args.language),
    },
    {
      name: "ha_get_sensors",
      label: "Get Smart Home Sensors",
      description: "Get a summary of the smart home environment from Home Assistant.",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          return JSON.stringify(await homeAssistant.getSensorSummary());
        } catch (e: any) {
          return `Home Assistant is not configured or unreachable: ${e.message}`;
        }
      },
    },
    {
      name: "ha_toggle_device",
      label: "Toggle Smart Home Device",
      description: "Toggle a smart home device via Home Assistant.",
      parameters: Type.Object({ entityId: Type.String() }),
      execute: async (args: any) => JSON.stringify(await homeAssistant.toggle(args.entityId)),
    },
    {
      name: "review_my_reasoning",
      label: "Review Reasoning",
      description: "Introspection tool to read your own past thought blocks for a given context.",
      parameters: Type.Object({ contextId: Type.String() }),
      execute: async (args: any) => reasoningTraces.reviewMyReasoning(userId, args.contextId),
    },
  ];
};
