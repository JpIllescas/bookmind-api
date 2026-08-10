import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

import { CONSTANTS } from './constants';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: CONSTANTS.DB_HOST,
  port: CONSTANTS.DB_PORT,
  username: CONSTANTS.DB_USERNAME,
  password: CONSTANTS.DB_PASSWORD,
  database: CONSTANTS.DB_NAME,
  schema: CONSTANTS.DB_SCHEMA,
  extra: { options: `-c search_path=${CONSTANTS.DB_SCHEMA}` },
  ssl: CONSTANTS.ENV === 'prod' ? { rejectUnauthorized: false } : false,
  // Sin esto, pg devuelve los bigint como string.
  parseInt8: true,
  entities: [join(__dirname, '..', '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', '..', 'migrations', '*.{ts,js}')],

  // Siempre false: el esquema se cambia solo con migraciones versionadas.
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
