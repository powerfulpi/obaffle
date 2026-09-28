import type { Attachment } from "discord.js";
import type { ChatImage } from "./types.js";
export declare const IMAGE_UNDERSTANDING_PROMPT: string;
export declare function isImageAttachment(attachment: Attachment): boolean;
export declare function loadAttachedImages(attachments: Pick<Attachment, "url" | "size">[]): Promise<ChatImage[]>;
export declare function detectImageType(bytes: Buffer): string | undefined;
