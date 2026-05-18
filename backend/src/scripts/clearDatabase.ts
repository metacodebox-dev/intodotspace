import { sequelize } from '../config/database';
import { Order } from '../models/Order';
import { Market } from '../models/Market';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script to clear all database data
 * Use this when deploying a new program to start fresh
 */
async function clearDatabase() {
  try {
    console.log('[ClearDB] Connecting to database...');
    await sequelize.authenticate();
    console.log('[ClearDB] Database connection established');

    console.log('[ClearDB] Clearing all data...');
    
    const deletedOrders = await Order.destroy({
      where: {},
      force: true,
    });
    console.log(`[ClearDB] Cleared ${deletedOrders} orders`);

    const deletedMarkets = await Market.destroy({
      where: {},
      force: true,
    });
    console.log(`[ClearDB] Cleared ${deletedMarkets} markets`);

    console.log('[ClearDB] Database cleared successfully');
    
  } catch (error) {
    console.error('[ClearDB] Error clearing database:', error);
    throw error;
  } finally {
    await sequelize.close();
    console.log('[ClearDB] Database connection closed');
  }
}

if (require.main === module) {
  clearDatabase()
    .then(() => {
      console.log('[ClearDB] Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[ClearDB] Failed:', error);
      process.exit(1);
    });
}

export { clearDatabase };

