/**
 * Lenient JSON extraction and repair for multi-provider LLM responses.
 * Handles fenced JSON, trailing commas, unescaped quotes, and truncated tails.
 */
export function repairJson(input: string, cutIncomplete = false): string {
  let t = input.replace(/,\s*([\]}])/g, '$1');
  if (cutIncomplete) {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    let lastGood = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        stack.pop();
        lastGood = i + 1;
      } else if (c === ',' && stack.length > 0) {
        lastGood = i;
      }
    }
    if (inStr || stack.length > 0) t = t.slice(0, lastGood);
  }

  const open: string[] = [];
  let inS = false;
  let e2 = false;
  for (const c of t) {
    if (inS) {
      if (e2) e2 = false;
      else if (c === '\\') e2 = true;
      else if (c === '"') inS = false;
      continue;
    }
    if (c === '"') inS = true;
    else if (c === '{' || c === '[') open.push(c);
    else if (c === '}' || c === ']') open.pop();
  }
  if (inS) t += '"';
  while (open.length) t += open.pop() === '{' ? '}' : ']';
  return t;
}

export function sanitizeJson(input: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  let valueEnded = false;
  const n = input.length;

  for (let i = 0; i < n; i++) {
    const c = input[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        out += c;
        continue;
      }
      if (c === '\\') {
        esc = true;
        out += c;
        continue;
      }
      if (c === '\n') {
        out += '\\n';
        continue;
      }
      if (c === '\r') {
        out += '\\r';
        continue;
      }
      if (c === '\t') {
        out += '\\t';
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        let nl = false;
        while (j < n && /\s/.test(input[j]!)) {
          if (input[j] === '\n') nl = true;
          j++;
        }
        const nx = input[j];
        if (
          nx === undefined ||
          nx === ',' ||
          nx === '}' ||
          nx === ']' ||
          nx === ':' ||
          (nl && (nx === '"' || nx === '{' || nx === '['))
        ) {
          inStr = false;
          valueEnded = true;
          out += c;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += c;
      continue;
    }
    if (/\s/.test(c)) {
      out += c;
      continue;
    }
    if (valueEnded && (c === '"' || c === '{' || c === '[')) out += ',';
    if (c === '"') {
      inStr = true;
      valueEnded = false;
      out += c;
      continue;
    }
    if (c === '}' || c === ']') {
      valueEnded = true;
      out += c;
      continue;
    }
    if (c === ',' || c === ':' || c === '{' || c === '[') {
      valueEnded = false;
      out += c;
      continue;
    }
    let j = i;
    while (j < n && /[^\s,:{}[\]"]/.test(input[j]!)) j++;
    out += input.slice(i, j);
    i = j - 1;
    valueEnded = true;
  }
  return out;
}

export function parseJsonLenient<T>(text: string): T {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const start = clean.search(/[[{]/);
  if (start < 0) {
    throw new Error('Model did not return JSON');
  }
  const open = clean[start]!;
  const close = open === '{' ? '}' : ']';
  const end = clean.lastIndexOf(close);
  const slice = end > start ? clean.slice(start, end + 1) : clean.slice(start);

  try {
    return JSON.parse(slice) as T;
  } catch {
    try {
      return JSON.parse(repairJson(slice)) as T;
    } catch {
      try {
        return JSON.parse(repairJson(slice, true)) as T;
      } catch {
        const fixed = sanitizeJson(slice);
        try {
          return JSON.parse(repairJson(fixed)) as T;
        } catch {
          return JSON.parse(repairJson(fixed, true)) as T;
        }
      }
    }
  }
}
