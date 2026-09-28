import type { ChatImage } from "./types.js";
export declare function isPublicAddress(address: string): boolean;
export declare function extractLinks(texts: string[]): string[];
export interface LinkPage {
    url: string;
    contentType: string;
    bytes: Buffer;
}
/** Resolve once and pin the validated public address to the socket, including redirects. */
export declare function readPublicLink(input: string, signal?: AbortSignal): Promise<LinkPage>;
export declare function pageText(page: LinkPage): string;
export interface LinkContext {
    text: string;
    images: ChatImage[];
}
export declare function loadLinkContext(texts: string[], imageSlots?: number, read?: typeof readPublicLink): Promise<LinkContext>;
export declare const LINK_INSTRUCTIONS: string;
