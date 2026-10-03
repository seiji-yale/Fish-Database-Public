/** One timestamped event on a line: a data change (version) or a chat message. */
export interface LineEvent {
  at: string; // ISO-8601 UTC timestamp
  byUserId: string;
}

/**
 * BR-4: a line's Last Update is its most recent data change or chat message, whichever is later,
 * shown with the user who made it. Timestamps are ISO-8601 UTC strings, so they compare as text.
 * On an exact tie the data change wins (it says more about the line than a message does).
 */
export function lastUpdate(dataChange: LineEvent, latestChat: LineEvent | null): LineEvent {
  if (latestChat !== null && latestChat.at > dataChange.at) return latestChat;
  return dataChange;
}
