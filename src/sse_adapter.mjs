/**
 * 客户端 SSE 流式适配器。
 * 服务器的每个普通 data 事件是一个新的 YAML 文本片段，必须逐字保留。
 */

function parseSseEvent(eventBlock) {
  let type = "text";
  const dataLines = [];

  for (const line of eventBlock.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      type = line.slice(6).trim() || "text";
    } else if (line.startsWith("data:")) {
      // SSE 规范允许 data: 后紧跟一个可选空格，该空格不属于数据。
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  return { type, data: dataLines.join("\n"), raw: eventBlock };
}

export function createSseEventDecoder(onEvent) {
  let buffer = "";

  function dispatchCompleteEvents() {
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop();
    for (const event of events) {
      if (event === "") continue;
      onEvent(parseSseEvent(event));
    }
  }

  return Object.freeze({
    push(text) {
      buffer += text;
      dispatchCompleteEvents();
    },
    finish() {
      // A compliant SSE response terminates every event with a blank line. A
      // nonempty tail is deliberately not dispatched, because it is truncated.
      return buffer;
    }
  });
}

/** Establish an SSE connection and forward complete server events. */
export function connectSse(options) {
  const { url, requestBody, signal, onText, onError, onDone, onRawEvent } = options;
  const controller = new AbortController();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone();
  };

  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: controller.signal
  }).then(async response => {
    if (!response.ok) {
      let payload;
      try { payload = await response.json(); } catch { payload = { error: { message: response.statusText } }; }
      onError?.({
        code: payload?.error?.code ?? "HTTP_ERROR",
        message: payload?.error?.message ?? `HTTP ${response.status}`,
        status: response.status
      });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError?.({ code: "NO_READER", message: "响应体不支持流式读取" });
      return;
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const eventDecoder = createSseEventDecoder(({ type, data }) => {
      onRawEvent?.(type, data);
      if (type === "error") {
        try { onError?.(JSON.parse(data)); } catch { onError?.({ code: "SSE_ERROR", message: data }); }
      } else if (type === "text") {
        if (data === "[DONE]") finish();
        else onText(data);
      } else if (type === "done") {
        finish();
      }
    });

    try {
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        eventDecoder.push(decoder.decode(value, { stream: true }));
      }
      eventDecoder.push(decoder.decode());
      eventDecoder.finish();
      finish();
    } catch (error) {
      if (error?.name !== "AbortError") onError?.({ code: "READ_ERROR", message: error?.message ?? "读取流失败" });
    } finally {
      reader.releaseLock();
    }
  }).catch(error => {
    if (error?.name !== "AbortError") onError?.({ code: "FETCH_ERROR", message: error?.message ?? "网络请求失败" });
  });

  return Object.freeze({ abort: () => controller.abort() });
}

/**
 * 创建流式文本累积器。
 * 返回一个对象，持续调用 add(chunk) 累积文本，并在结束时返回完整文本。
 * 
 * @returns {{ add: (text: string) => void, finish: () => string }}
 */
export function createTextAccumulator() {
  let text = "";
  return {
    add(chunk) {
      text += chunk;
    },
    finish() {
      return text;
    }
  };
}
