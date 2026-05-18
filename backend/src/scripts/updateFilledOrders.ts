/**
 * Script to update orders that were executed on-chain but not updated in the database
 * This is useful when orders are executed via playground script or other external methods
 */

import { Order } from '../models/Order';
import { sequelize } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

async function updateFilledOrders() {
  try {
    // Connect to database
    await sequelize.authenticate();
    console.log('[Script] Database connection established');

    const orderIds = [1768585492, 1768585429];
    console.log(`[Script] Searching for orders with order_id: ${orderIds.join(', ')}`);

    const orders = await Order.findAll({
      where: {
        orderId: orderIds,
      },
    });

    if (orders.length === 0) {
      console.log('[Script] No orders found with specified order_ids');
      return;
    }

    console.log(`[Script] Found ${orders.length} order(s):`);
    orders.forEach((order) => {
      console.log(`  - Order ID: ${order.id}`);
      console.log(`    On-Chain Order ID: ${order.orderId}`);
      console.log(`    Side: ${order.side}`);
      console.log(`    Status: ${order.status}`);
      console.log(`    Size: ${order.getSizeBigInt().toString()}`);
      console.log(`    Filled: ${order.getFilledBigInt().toString()}`);
      console.log(`    On-Chain PDA: ${order.onChainOrder || 'N/A'}`);
      console.log('');
    });

    console.log('[Script] Updating orders to filled status');
    
    for (const order of orders) {
      const size = order.getSizeBigInt();
      await order.update({
        status: 'filled',
        filled: size.toString(),
      });
      console.log(`[Script] Updated order ${order.id} (on-chain ID: ${order.orderId})`);
    }

    console.log(`[Script] Successfully updated ${orders.length} order(s)`);

  } catch (error) {
    console.error('[Script] Error updating orders:', error);
    throw error;
  } finally {
    await sequelize.close();
    console.log('[Script] Database connection closed');
  }
}

if (require.main === module) {
  updateFilledOrders()
    .then(() => {
      console.log('[Script] Completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Script] Failed:', error);
      process.exit(1);
    });
}

export { updateFilledOrders };

