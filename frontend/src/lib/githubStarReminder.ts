export function isGithubStarReminderMilestone(count: number) {
  return count === 2 || count === 5 || (count >= 10 && count % 10 === 0);
}
