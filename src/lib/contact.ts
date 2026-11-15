/** The contact form's topics and rules, shared by the page and the API route. */
export type ContactTopic = "account" | "delete" | "privacy" | "other";

export const CONTACT_TOPICS: { id: ContactTopic; label: string; hint: string; placeholder: string }[] = [
  {
    id: "account",
    label: "Account or sign-in",
    hint: "Can't sign in, no confirmation email, changing your email…",
    placeholder: "What happens, and what did you expect? Which email do you sign in with?",
  },
  {
    id: "delete",
    label: "Delete my account or data",
    hint: "Remove your account, or get a copy of your data.",
    placeholder: "Tell us what you'd like: delete the whole account, or send you a copy of your data.",
  },
  {
    id: "privacy",
    label: "Privacy question",
    hint: "What Slate stores, where, and who can see it.",
    placeholder: "What would you like to know?",
  },
  {
    id: "other",
    label: "Something else",
    hint: "Feedback, a question, or just hello.",
    placeholder: "What's on your mind?",
  },
];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 5000;

export interface ContactInput {
  topic: string;
  email: string;
  message: string;
}
export type ContactErrors = Partial<Record<keyof ContactInput, string>>;

export const isTopic = (value: unknown): value is ContactTopic => CONTACT_TOPICS.some((topic) => topic.id === value);

/** What's wrong with a message, field by field, in plain words. Empty when it can be sent. */
export function validateContact(input: ContactInput): ContactErrors {
  const errors: ContactErrors = {};
  if (!isTopic(input.topic)) errors.topic = "Choose what your message is about.";
  const email = input.email.trim();
  if (!email) errors.email = "Add your email, so you can get a reply.";
  else if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "That email address doesn't look right.";
  const message = input.message.trim();
  if (!message) errors.message = "Write a message.";
  else if (message.length < MESSAGE_MIN)
    errors.message = `A little more detail, please (at least ${MESSAGE_MIN} characters).`;
  else if (message.length > MESSAGE_MAX)
    errors.message = `That's over ${MESSAGE_MAX.toLocaleString("en")} characters. Please shorten it.`;
  return errors;
}
