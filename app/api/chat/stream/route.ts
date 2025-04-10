import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { submitQuestion } from "@/lib/langgraph";
import {
    ChatRequestBody,
    StreamMessage,
    StreamMessageType,
    SSE_DATA_PREFIX,
    SSE_LINE_DELIMITER,
  } from "@/lib/types";
import { auth } from "@clerk/nextjs/server";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

// SSE helper function
function sendSSEMessage(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    data: StreamMessage
) {
    const encoder = new TextEncoder();
    return writer.write(
        encoder.encode(
            `${SSE_DATA_PREFIX}${JSON.stringify(data)}${SSE_LINE_DELIMITER}`
        )
    );
}


export async function POST(req: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return new Response("Unauthorized", { status: 401 });
        }
        const body = (await req.json()) as ChatRequestBody;
        const { messages, newMessage, chatId } = body;

        const convex = getConvexClient();

        // prepare data structure that supports our stream
        const stream = new TransformStream ({}, { highWaterMark: 1024 });
        const writer = stream.writable.getWriter();

        const response = new Response(stream.readable, {
            headers: {
                "Content-Type": "text/event-stream",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no", //disable buffering for nginx which is required for SSE to work properly
            },
        });

        (async () => {
            try {
                // Stream will be implemented here

                // Send initial connection establish message
                await sendSSEMessage(writer, {type: StreamMessageType.Connected});

                // Save user message to convex db
                await convex.mutation(api.messages.send, {
                    chatId,
                    content: newMessage,
                });

                // Convert messages to Langchain format
                const langChainMessages = [
                    ...messages.map((msg) =>
                    msg.role === "user"
                        ? new HumanMessage(msg.content)
                        : new AIMessage(msg.content)
                ),
                new HumanMessage(newMessage),
                ];

                try {
                    // Create event stream
                    const eventStream = await submitQuestion(langChainMessages, chatId);

                    // Process the events
                    for await (const event of eventStream) {
                        console.log("Events", event);

                        if (event.event === "on_chat_model_stream") {
                            const token = event.data.chunk;
                            if (token) {
                                // Access the text property correctly
                                const text = token.content.at(0)?.text;
                                if (text) {
                                    await sendSSEMessage(writer, {
                                        type: StreamMessageType.Token,
                                        token: text,
                                    });
                                }

                            }

                        } else if (event.event === "on_tool_start") {
                            await sendSSEMessage(writer, {
                                type: StreamMessageType.ToolStart,
                                tool: event.name || "unknown",
                                input: event.data.input,
                            });

                        } else if (event.event === "on_tool_end") {
                            const toolMessage = new ToolMessage(event.data.output);

                            await sendSSEMessage(writer, {
                                type: StreamMessageType.ToolEnd,
                                tool: toolMessage.lc_kwargs.name || "unknown",
                                output: event.data.output,
                            });

                        }
                    }
                        // Send completion message
                    await sendSSEMessage(writer, { type: StreamMessageType.Done });
                } catch (streamError) {
                    console.error("Error in stream:", streamError);
                    await sendSSEMessage(writer, {
                    type: StreamMessageType.Error,
                    error: 
                    streamError instanceof Error 
                    ? streamError.message 
                    : "Stream processing failed",
                    });
                }

            } catch (error) {
                console.error("Error in Stream:", error);
                await sendSSEMessage(writer, {
                    type: StreamMessageType.Error,
                    error: error instanceof Error 
                    ? error.message 
                    : "Unknown error",
                });
            } finally {
                try {
                    await writer.close();
                } catch (closeError) {
                    console.error("Error closing writer:", closeError);
                }
            }
        })();

        

        return response;

    } catch (error) {
        console.error("Error in chat API:", error);
        return NextResponse.json(
            { error: "Failed to process chat request" } as const,
            { status: 500 }
        );
    }
    
}