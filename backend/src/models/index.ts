import { Market } from './Market';
import { Order } from './Order';
import { Position } from './Position';
import { UserProfile } from './UserProfile';
import { Referral } from './Referral';
import { SpacePoints } from './SpacePoints';
import { BetaAccess } from './BetaAccess';
import { Comment, CommentStar, CommentReport } from './Comment';
import { Notification } from './Notification';
import { FaucetClaim } from './FaucetClaim';
import { Competition } from './Competition';
import { CompetitionReward } from './CompetitionReward';
import { CompetitionLeaderboard } from './CompetitionLeaderboard';
import { CompetitionPointSnapshot } from './CompetitionPointSnapshot';

// Export all models
export { Market, Order, Position, UserProfile, Referral, SpacePoints, BetaAccess, Comment, CommentStar, CommentReport, Notification, FaucetClaim, Competition, CompetitionReward, CompetitionLeaderboard, CompetitionPointSnapshot };

// Initialize associations here if needed in the future
export function initializeModels() {
  // Set up Position -> Market association
  Position.belongsTo(Market, {
    foreignKey: 'marketAddress', // This is the camelCase property name
    targetKey: 'marketAddress', // Market model uses marketAddress
    as: 'market',
  });

  // Set up Order -> Market association. Order.marketId stores the Solana
  // market PDA (matches Market.marketAddress), not the numeric market_id.
  Order.belongsTo(Market, {
    foreignKey: 'marketId',
    targetKey: 'marketAddress',
    as: 'market',
  });

  // Competition associations
  Competition.hasMany(CompetitionReward, { foreignKey: 'competitionId', as: 'rewards' });
  CompetitionReward.belongsTo(Competition, { foreignKey: 'competitionId' });
  Competition.hasMany(CompetitionLeaderboard, { foreignKey: 'competitionId', as: 'leaderboard' });
  CompetitionLeaderboard.belongsTo(Competition, { foreignKey: 'competitionId' });
  Competition.hasMany(CompetitionPointSnapshot, { foreignKey: 'competitionId', as: 'snapshots' });
  CompetitionPointSnapshot.belongsTo(Competition, { foreignKey: 'competitionId' });
}
