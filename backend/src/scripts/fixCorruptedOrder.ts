import { sequelize } from '../config/database';
import { Order } from '../models/Order';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script to fix corrupted orders
 * Usage: 
 *   npm run ts-node src/scripts/fixCorruptedOrder.ts <orderId> [status]
 *   status can be: 'cancelled' or 'filled' (default: 'cancelled')
 */
async function fixCorruptedOrder(orderId: string, status: 'cancelled' | 'filled' = 'cancelled') {
  try {
    console.log(`[FixOrder] Connecting to database...`);
    await sequelize.authenticate();
    console.log(`[FixOrder] Database connection established`);

    console.log(`[FixOrder] Looking for order: ${orderId}`);
    const order = await Order.findOne({
      where: { id: orderId }
    });

    if (!order) {
      console.error(`[FixOrder] Order not found: ${orderId}`);
      process.exit(1);
    }

    console.log(`[FixOrder] Found order:`);
    console.log(`  ID: ${order.id}`);
    console.log(`  Market: ${order.marketId}`);
    console.log(`  Side: ${order.side}`);
    console.log(`  Type: ${order.type}`);
    console.log(`  Price: ${order.price} bps`);
    console.log(`  Size: ${order.size}`);
    console.log(`  Filled: ${order.filled}`);
    console.log(`  Current Status: ${order.status}`);
    console.log(`  User: ${order.userId}`);

    // Update order status
    order.setDataValue('status', status);
    
    // If marking as filled, set filled amount to size
    if (status === 'filled') {
      const orderSize = order.getSizeBigInt();
      order.setDataValue('filled', orderSize.toString());
    }

    await order.save();
    console.log(`[FixOrder] Order ${orderId} updated to status: ${status}`);
    
  } catch (error) {
    console.error(`[FixOrder] Error fixing order:`, error);
    throw error;
  } finally {
    await sequelize.close();
    console.log(`[FixOrder] Database connection closed`);
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run ts-node src/scripts/fixCorruptedOrder.ts <orderId> [status]');
  console.error('  status can be: "cancelled" or "filled" (default: "cancelled")');
  process.exit(1);
}

const orderId = args[0];
const status = (args[1] as 'cancelled' | 'filled') || 'cancelled';

if (status !== 'cancelled' && status !== 'filled') {
  console.error(`Invalid status: ${status}. Must be "cancelled" or "filled"`);
  process.exit(1);
}

if (require.main === module) {
  fixCorruptedOrder(orderId, status)
    .then(() => {
      console.log(`[FixOrder] Done`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[FixOrder] Failed:`, error);
      process.exit(1);
    });
}

export { fixCorruptedOrder };



