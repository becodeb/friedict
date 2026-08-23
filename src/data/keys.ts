/** Claves de caché. Centralizadas para que invalidar sea inequívoco. */
export const qk = {
  profile: (userId: string) => ['profile', userId] as const,
  myGroups: () => ['groups'] as const,
  group: (groupId: string) => ['group', groupId] as const,
  members: (groupId: string) => ['members', groupId] as const,
  invites: (groupId: string) => ['invites', groupId] as const,
  predictions: (groupId: string) => ['predictions', groupId] as const,
  prediction: (predictionId: string) => ['prediction', predictionId] as const,
  timeline: (predictionId: string) => ['timeline', predictionId] as const,
  resolution: (predictionId: string) => ['resolution', predictionId] as const,
  scores: (predictionId: string) => ['scores', predictionId] as const,
  leaderboard: (groupId: string) => ['leaderboard', groupId] as const,
  activity: (groupId: string) => ['activity', groupId] as const,
  templates: () => ['templates'] as const,
  invitePreview: (token: string) => ['invite-preview', token] as const,
} as const
