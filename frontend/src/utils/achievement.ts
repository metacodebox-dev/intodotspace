export interface Achievement {
  id: string;
  name: string;
  description: string;
  image: string;
}

export const achievements: Record<string, Achievement> = {
  firstLogin: {
    id: 'firstLogin',
    name: 'First Login',
    description: 'Sign in for the first time',
    image: '/assets/achievement/statue.png',
  },
  trader: {
    id: 'trader',
    name: 'Trader',
    description: 'Complete 10 trades',
    image: '/assets/achievement/helmet.png',
  },
  pointCollector: {
    id: 'pointCollector',
    name: 'Point Collector',
    description: 'Earn more than 5,000 points',
    image: '/assets/achievement/tag.png',
  },
};

export function getUnlockedAchievements(params: {
  isNewUser: boolean;
  totalTrades: number;
  totalPoints: number;
}): Set<string> {
  const unlocked = new Set<string>();

  // First Login: unlocked when user is no longer new (has completed first login)
  if (!params.isNewUser) {
    unlocked.add('firstLogin');
  }

  // Trader: unlocked after 10 trades
  if (params.totalTrades >= 10) {
    unlocked.add('trader');
  }

  // Point Collector: unlocked when user has more than 5000 points
  if (params.totalPoints > 5000) {
    unlocked.add('pointCollector');
  }

  return unlocked;
}
