import { ConvexHttpClient } from "convex/browser";

// create singleton instance of the convex HTTP client
export const getConvexClient = () => {
    return new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
};