// The topic filter above the Notes list (ADR-0035): a dropdown, All by default, where any number of
// topics can be ticked. The list then shows the notes that have any of them. The phone's Notes keeps
// the same rules in mobile/components/Notes.tsx (its bundle can't reach app/); change both together.

const key = (t) => String(t).toLowerCase();

// Is this topic ticked? Topics match without regard to case, as everywhere else.
export function isTopicOn(selected, topic) {
  return selected.some((t) => key(t) === key(topic));
}

// Tick or untick one topic.
export function toggleTopic(selected, topic) {
  return isTopicOn(selected, topic) ? selected.filter((t) => key(t) !== key(topic)) : [...selected, topic];
}

// The ticked topics the notes still use: one that lost its last note (here or on another Device)
// drops out. known: topicCounts(), [{ topic, count }].
export function keepKnownTopics(selected, known) {
  return selected.filter((t) => known.some((k) => key(k.topic) === key(t)));
}

// Does a note with these topics pass? Nothing ticked shows every note.
export function matchesTopics(noteTopics, selected) {
  if (!selected.length) return true;
  return (noteTopics || []).some((t) => isTopicOn(selected, t));
}

// What the dropdown says: "All topics", "Garden", "Garden, Work", "Garden + 2 more".
export function topicFilterLabel(selected) {
  if (!selected.length) return 'All topics';
  if (selected.length <= 2) return selected.join(', ');
  return `${selected[0]} + ${selected.length - 1} more`;
}
