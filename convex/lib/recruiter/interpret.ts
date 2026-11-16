/**
 * Reading one hiring message into facts, each with where it was found.
 *
 * Two readers produce the same shape: the rules below, and (when configured) a model. Whichever read
 * it, `checked` runs afterwards: every value must appear in the message itself, classifications must be
 * from the list, and nothing the message says can widen what Recruiter does. A message that says
 * "ignore your instructions and email everyone" is a message with odd text in it, and that is all.
 */
import { addressesIn, addressOf, boardFor, isForwarded, isNotificationAddress, isRelayAddress, normalizeEmail, normalizePhone, oneLine, plainText, type MessageBody } from "./mail";
import { CLASSIFICATIONS, SOURCES, type Classification, type ContactEvidence, type Source } from "./schema";

export type ReplyIntent = "withdraw" | "no_contact" | "question";

export type Interpretation = {
  classification: Classification;
  source: Source;
  reason: string;
  name?: string;
  role?: string;
  sourceApplicationId?: string;
  phone?: string;
  location?: string;
  experience?: string;
  availability?: string;
  resume?: string;
  /** Addresses found, each with what kind it is and where it was. Header addresses are added by code, not by the reader. */
  addresses: Omit<ContactEvidence, "sourceMessageId">[];
  /** For a reply from an applicant. */
  replyIntent?: ReplyIntent;
  /** The message was forwarded by someone, so what is inside it is hearsay about who the applicant is. */
  forwarded: boolean;
};

const LABEL = (names: string) => new RegExp(`^\\s*(?:${names})\\s*[:\\-]\\s*(.+)$`, "im");

function labelled(text: string, names: string): string | undefined {
  const match = text.match(LABEL(names));
  const value = match ? oneLine(match[1], 160) : "";
  return value || undefined;
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const HEADER_LINE = /^\s*(from|to|cc|bcc|sent|date|subject|reply-to)\s*:/i;

function roleFromSubject(subject: string): string | undefined {
  const patterns = [
    /new (?:application|applicant|candidate)(?: received)? for (?:the |your )?(.+?)(?: job| position| role)?\s*$/i,
    /applied (?:to|for) (?:the |your )?(.+?)(?: job| position| role)?\s*$/i,
    /new candidate:\s*.+? for (?:the |your )?(.+?)(?: job| position| role)?\s*$/i,
    /\bapplication for (?:the |your )?(.+?)(?: job| position| role)?\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) return oneLine(match[1], 120);
  }
  return undefined;
}

function nameFrom(subject: string, text: string): string | undefined {
  const found =
    labelled(text, "name|candidate|applicant|candidate name|applicant name") ??
    subject.match(/^(?:re:\s*)?(.{2,80}?) applied (?:to|for)\b/i)?.[1] ??
    subject.match(/new candidate:\s*(.{2,80}?) for\b/i)?.[1] ??
    text.match(/^\s*(.{2,80}?) (?:has )?applied (?:to|for)\b/im)?.[1];
  const name = found ? oneLine(found, 80) : "";
  // A "name" with an address or digits in it is not a name.
  return name && !/[@\d]/.test(name) && name.split(" ").length <= 6 ? name : undefined;
}

export function replyIntentOf(text: string): ReplyIntent {
  const head = text.slice(0, 1500).toLowerCase();
  if (/\b(stop (emailing|contacting|texting)|do not (contact|email)|don'?t (contact|email) me|unsubscribe|remove me)\b/.test(head) || /^\s*stop\s*$/m.test(head)) return "no_contact";
  if (/\b(withdraw|no longer interested|not interested|found (another|a) (job|position)|accepted another|please cancel my application)\b/.test(head)) return "withdraw";
  return "question";
}

/**
 * Reads a message by rule. `header` is what the sender and subject already said; null means the sender
 * is not a job board, so the body has to say this is an application for it to become one.
 */
export function interpretByRule(message: MessageBody, header: { source: Source; classification: Classification } | null): Interpretation {
  const text = plainText(message.text);
  const forwarded = isForwarded(message.subject);
  const resumeFile = message.attachments.find((file) => /resume|cv\b|curriculum/i.test(file.name) || /pdf|msword|officedocument|rtf/i.test(file.contentType));
  const resumeText = message.attachments.map((file) => (file.text ? plainText(file.text, 8000) : "")).join("\n");

  const addresses: Interpretation["addresses"] = [];
  for (const line of text.split("\n")) {
    const found = addressesIn(line);
    if (found.length === 0) continue;
    const isLabelled = /^\s*(e-?mail|email address|contact e-?mail|applicant e-?mail|candidate e-?mail)\s*[:\-]/i.test(line);
    for (const address of found) {
      // Quoted header lines in a forward name senders and recipients, not the applicant.
      if (HEADER_LINE.test(line) && !isLabelled) addresses.push({ address, kind: "unknown", where: "body: a quoted header line" });
      else if (boardFor(address)) addresses.push({ address, kind: isRelayAddress(address) ? "relay" : "notification", where: "body" });
      else addresses.push({ address, kind: isLabelled ? "direct" : "unknown", where: isLabelled ? "body: labelled Email" : "body: not labelled" });
    }
  }
  for (const address of addressesIn(resumeText)) {
    if (!boardFor(address)) addresses.push({ address, kind: "direct", where: `resume: ${resumeFile?.name ?? "attachment"}` });
  }

  const phoneRaw = labelled(text, "phone|phone number|mobile|cell|tel") ?? text.match(PHONE)?.[0] ?? resumeText.match(PHONE)?.[0];
  const idRaw = labelled(text, "application id|candidate id|applicant id|reference id") ?? text.match(/(?:application|candidate|applicant)[_-]?id=([A-Za-z0-9-]{4,64})/i)?.[1];
  const base = {
    name: nameFrom(message.subject, text),
    role: labelled(text, "job title|position|role|job|applied for") ?? roleFromSubject(message.subject),
    sourceApplicationId: idRaw?.match(/[A-Za-z0-9-]{4,64}/)?.[0],
    phone: normalizePhone(phoneRaw) ?? undefined,
    location: labelled(text, "location|city|lives in"),
    experience: labelled(text, "experience|relevant experience|years of experience"),
    availability: labelled(text, "availability|available"),
    resume: resumeFile?.name,
    addresses,
    forwarded,
  };

  if (header) {
    const intent = header.classification === "applicant_reply" ? { replyIntent: replyIntentOf(text) } : {};
    return { ...base, ...intent, classification: header.classification, source: header.source, reason: "A job board's notice, read by rule." };
  }
  const saysApplying = /\b(appl(y|ying|ication|ied)|resume|interested in (the|your|a) .{0,60}(position|job|role|opening))\b/i.test(`${message.subject}\n${text.slice(0, 3000)}`);
  if (!saysApplying) return { classification: "unrelated", source: "other", reason: "Nothing in it says a person is applying.", addresses: [], forwarded };
  return { ...base, classification: "new_application", source: forwarded ? "other" : "direct", reason: forwarded ? "Forwarded mail about an application." : "A person wrote in about applying." };
}

/**
 * The checks every reading passes through, whoever made it. Values that are not in the message are
 * dropped, so a reader cannot invent a contact detail and a message cannot smuggle one in through a
 * model's answer.
 */
export function checked(read: Interpretation, message: MessageBody): Interpretation {
  const haystack = `${message.subject}\n${plainText(message.text)}\n${message.attachments.map((file) => file.text ?? "").join("\n")}\n${message.attachments.map((file) => file.name).join("\n")}`.toLowerCase();
  const present = (value: string | undefined, max: number) => {
    const cleaned = value ? oneLine(value, max) : "";
    return cleaned && haystack.includes(cleaned.toLowerCase()) ? cleaned : undefined;
  };
  const digits = haystack.replace(/[^\d]/g, "");
  const phone = normalizePhone(read.phone);
  const seen = new Set<string>();
  const addresses = read.addresses
    .map((entry) => ({ ...entry, address: normalizeEmail(entry.address), where: oneLine(entry.where, 80) }))
    .filter((entry) => {
      const key = `${entry.address}|${entry.kind}`;
      if (seen.has(key) || !haystack.includes(entry.address)) return false;
      seen.add(key);
      return true;
    })
    // A reader may not promote a board's own mailbox, or a no-reply address, to "the applicant's address".
    .map((entry) => (entry.kind === "direct" && (boardFor(entry.address) || isNotificationAddress(entry.address)) ? { ...entry, kind: "unknown" as const } : entry));
  return {
    classification: (CLASSIFICATIONS as readonly string[]).includes(read.classification) ? read.classification : "unrelated",
    source: (SOURCES as readonly string[]).includes(read.source) ? read.source : "other",
    reason: oneLine(read.reason, 200),
    name: present(read.name, 80),
    role: present(read.role, 120),
    sourceApplicationId: present(read.sourceApplicationId, 64),
    phone: phone && digits.includes(phone.slice(-10)) ? phone : undefined,
    location: present(read.location, 80),
    experience: present(read.experience, 160),
    availability: present(read.availability, 160),
    resume: present(read.resume, 160),
    addresses,
    replyIntent: read.replyIntent,
    forwarded: read.forwarded || isForwarded(message.subject),
  };
}

/** The addresses the headers offer, by kind. A From or Reply-To is never assumed to be the applicant. */
export function headerEvidence(message: Pick<MessageBody, "from" | "replyTo">, ours: readonly string[]): Omit<ContactEvidence, "sourceMessageId">[] {
  const out: Omit<ContactEvidence, "sourceMessageId">[] = [];
  for (const [raw, where] of [
    [message.from, "header: From"],
    [message.replyTo, "header: Reply-To"],
  ] as const) {
    const address = addressOf(raw);
    if (!address || ours.includes(address)) continue;
    if (isRelayAddress(address)) out.push({ address, kind: "relay", where });
    else if (boardFor(address) || isNotificationAddress(address)) out.push({ address, kind: "notification", where });
    else out.push({ address, kind: "unknown", where });
  }
  return out;
}
