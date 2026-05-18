import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Production-grade database configuration with connection pooling
const sequelize = new Sequelize(
  process.env.DATABASE_URL || 
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'space_prediction'}`,
  {
    dialect: 'postgres',
    logging: false,
    timezone: '+00:00', // Force UTC timezone for all timestamps
    pool: {
      max: 8,          // Below Railway hard cap
      min: 3,          // Keep warm connections alive — avoids SSL handshake latency per query
      acquire: 10000,  // Fail fast if blocked (was 30s — blocking too long wastes request slots)
      idle: 60000,     // Keep idle connections alive 60s (was 5s — was killing warm pool)
      evict: 10000,
    },
    retry: {
      max: 3,
      match: [/SequelizeConnectionError/, /SequelizeConnectionRefusedError/, /SequelizeHostNotFoundError/, /SequelizeHostNotReachableError/, /SequelizeInvalidConnectionError/, /SequelizeConnectionTimedOutError/, /TimeoutError/],
    },
    dialectOptions: {
      statement_timeout: 30000, // Kill long queries after 30s so they return connections
      idle_in_transaction_session_timeout: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
    // Production optimizations
    benchmark: false,
    define: {
      timestamps: true,
      underscored: false,
    },
  }
);

export async function connectDatabase() {
  try {
    await sequelize.authenticate();
    console.log('[Database] Connection established successfully');
    
    // Test query to ensure connection is working
    await sequelize.query('SELECT 1');
    
    return sequelize;
  } catch (error) {
    console.error('[Database] Unable to connect to database:', error);
    throw error;
  }
}

export { sequelize };
