// nomad.ai.chat messages. A message's content may be a string, or OpenAI-style parts
// (text and image_url). `images` is the short form: one or more data URLs or http(s)
// URLs, appended after the text. The runtime only ever sends image_url parts.

const MAX_IMAGES_PER_MESSAGE = 8;
const MAX_DATA_URL_CHARS = 6_000_000;
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

export function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('nomad.ai.chat messages must be an array.');
  }
  return messages.map(normalizeMessage);
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('nomad.ai.chat messages must be objects.');
  }
  const extra = imageList(message.images);
  const content = message.content;
  const partsIn = Array.isArray(content);
  if (!partsIn && extra.length === 0) {
    if (typeof content !== 'string' && content != null) {
      throw new Error('nomad.ai.chat content must be a string or an array of text and image_url parts.');
    }
    if (message.images == null) return message;
    const next = { ...message };
    delete next.images;
    return next;
  }

  const parts = [];
  let images = 0;
  const take = (url) => {
    images += 1;
    if (images > MAX_IMAGES_PER_MESSAGE) {
      throw new Error('nomad.ai.chat accepts at most 8 images on a message.');
    }
    return imagePart(requireImageUrl(url));
  };

  if (typeof content === 'string') {
    if (content) parts.push({ type: 'text', text: content });
  } else if (partsIn) {
    for (const part of content) parts.push(normalizePart(part, take));
  } else if (content != null) {
    throw new Error('nomad.ai.chat content must be a string or an array of text and image_url parts.');
  }

  for (const url of extra) parts.push(take(url));

  const next = { ...message, content: parts };
  delete next.images;
  return next;
}

function imageList(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) {
    throw new Error('nomad.ai.chat images must be an array of image URLs.');
  }
  return images.map(imageEntryUrl);
}

function imageEntryUrl(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') return entry.url;
  throw new Error('nomad.ai.chat images must be data:image or http(s) URLs.');
}

function normalizePart(part, take) {
  if (!part || typeof part !== 'object') {
    throw new Error('nomad.ai.chat content parts must be text or image_url.');
  }
  if (part.type === 'text') {
    if (typeof part.text !== 'string') {
      throw new Error('nomad.ai.chat text parts need a string text field.');
    }
    return { type: 'text', text: part.text };
  }
  if (part.type === 'image_url') {
    const url = part.image_url && typeof part.image_url.url === 'string'
      ? part.image_url.url
      : part.url;
    return take(url);
  }
  throw new Error('nomad.ai.chat content parts must be text or image_url.');
}

function imagePart(url) {
  return { type: 'image_url', image_url: { url } };
}

function requireImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('nomad.ai.chat images must be data:image or http(s) URLs.');
  }
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    if (!DATA_IMAGE.test(trimmed)) {
      throw new Error('nomad.ai.chat image data URLs must be png, jpeg, webp, or gif.');
    }
    const compact = trimmed.replace(/\s/g, '');
    if (compact.length > MAX_DATA_URL_CHARS) {
      throw new Error('An image is too large to send. Resize it before calling nomad.ai.chat.');
    }
    return compact;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  throw new Error('nomad.ai.chat images must be data:image or http(s) URLs.');
}
