import { mutation, query } from "./_generated/server";
import { v } from "convex/values";


export const list = query({
    args: { chatId: v.id("chats") },
    handler: async (ctx, args) => {
        const messages = await ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
        .order("asc")
        .collect();

        return messages;
    },
});

export const send = mutation({
    args: {
        chatId: v.id("chats"),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        // save users message with preserved new lines
        const messageId = await ctx.db.insert("messages", {
            chatId: args.chatId,
            content: args.content.replace(/\n/g, "\\n"),
            role: "user",
            createdAt: Date.now(),
        });

        return messageId;
    },
});

export const store = mutation({
    args: {
        chatId: v.id("chats"),
        content: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
    },
    handler: async (ctx, args) => {
        // store message with preserved new lines
        const messageId = await ctx.db.insert("messages", {
            chatId: args.chatId,
            content: args.content
                .replace(/\n/g, "\\n")
                // don't escape HTML we will trust the content as it is from out system
                .replace(/\\/g, "\\\\"), // only escape back slashes
            role: args.role,
            createdAt: Date.now(),
        });

        return messageId;
    },
});

export const getLastMessage = query({
    args: { chatId: v.id("chats") },
    handler: async(ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error ("Not Authorized");
        }

        const chat = await ctx.db.get(args.chatId);
        if (!chat || chat.userId != identity.subject) {
            throw new Error ("Unauthorized");
        }

        const lastMessage = await ctx.db
            .query("messages")
            .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
            .order("desc")
            .first();

        return lastMessage;
    }
})