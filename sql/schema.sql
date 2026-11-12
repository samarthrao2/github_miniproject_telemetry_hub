-- Fleet Telemetrics Hub: MySQL 8.4 schema.
-- Statements are separated by the marker below and executed one by one by scripts/migrate.ts.

CREATE TABLE fleet_assets (
  asset_id   INT NOT NULL AUTO_INCREMENT,
  vehicle_id VARCHAR(20) NOT NULL,
  brand      VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id),
  UNIQUE KEY uq_fleet_assets_vehicle (vehicle_id),
  KEY idx_fleet_assets_brand (brand),
  CONSTRAINT chk_vehicle_id CHECK (CHAR_LENGTH(TRIM(vehicle_id)) > 0)
)
--> statement-breakpoint

-- High-volume IoT table, RANGE-partitioned by time (monthly). MySQL cannot put foreign keys on
-- partitioned tables, so the asset link is enforced by the trg_telemetry_check_asset trigger instead.
-- MySQL has no BRIN; a B-tree on `timestamp` is used, and partition pruning does the coarse filtering.
CREATE TABLE telemetry_logs (
  log_id        BIGINT NOT NULL AUTO_INCREMENT,
  asset_id      INT NOT NULL,
  `timestamp`   DATETIME NOT NULL,
  gps_latitude  DOUBLE NULL,
  gps_longitude DOUBLE NULL,
  speed         FLOAT NULL,
  engine_temp_c FLOAT NULL,
  engine_rpm    FLOAT NULL,
  odometer      DOUBLE NULL,
  sensor_data   JSON NOT NULL,
  PRIMARY KEY (log_id, `timestamp`),
  KEY idx_telemetry_asset_ts (asset_id, `timestamp`),
  KEY idx_telemetry_ts (`timestamp`),
  CONSTRAINT chk_speed CHECK (speed IS NULL OR speed >= 0),
  CONSTRAINT chk_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_lon CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_sensor_json CHECK (JSON_VALID(sensor_data))
)
PARTITION BY RANGE COLUMNS (`timestamp`) (
  PARTITION p_before VALUES LESS THAN ('2023-01-01'),
  PARTITION p202301  VALUES LESS THAN ('2023-02-01'),
  PARTITION p202302  VALUES LESS THAN ('2023-03-01'),
  PARTITION pmax     VALUES LESS THAN (MAXVALUE)
)
--> statement-breakpoint

CREATE TABLE maintenance_tickets (
  ticket_id         INT NOT NULL AUTO_INCREMENT,
  asset_id          INT NOT NULL,
  issue_description TEXT NOT NULL,
  failure_type      VARCHAR(60) NOT NULL,
  subsystem         ENUM('engine','brake','battery') NOT NULL,
  status            ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  occurred_at       DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id),
  KEY idx_tickets_asset (asset_id),
  KEY idx_tickets_status (status),
  CONSTRAINT fk_tickets_asset FOREIGN KEY (asset_id) REFERENCES fleet_assets (asset_id) ON DELETE CASCADE,
  CONSTRAINT chk_ticket_desc CHECK (CHAR_LENGTH(TRIM(issue_description)) > 0)
)
--> statement-breakpoint

CREATE TABLE ticket_audit (
  audit_id        INT NOT NULL AUTO_INCREMENT,
  ticket_id       INT NOT NULL,
  action          ENUM('UPDATE','DELETE') NOT NULL,
  old_description TEXT NULL,
  new_description TEXT NULL,
  old_status      VARCHAR(20) NULL,
  new_status      VARCHAR(20) NULL,
  changed_by      VARCHAR(100) NOT NULL,
  changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_audit_ticket (ticket_id)
)
--> statement-breakpoint

CREATE TABLE users (
  user_id       INT NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','viewer') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username)
)
--> statement-breakpoint

-- ---------- Triggers ----------

CREATE TRIGGER trg_telemetry_check_asset BEFORE INSERT ON telemetry_logs
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fleet_assets WHERE asset_id = NEW.asset_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'telemetry_logs.asset_id does not exist in fleet_assets';
  END IF;
END
--> statement-breakpoint

CREATE TRIGGER trg_asset_delete_telemetry BEFORE DELETE ON fleet_assets
FOR EACH ROW
BEGIN
  DELETE FROM telemetry_logs WHERE asset_id = OLD.asset_id;
END
--> statement-breakpoint

CREATE TRIGGER trg_ticket_after_update AFTER UPDATE ON maintenance_tickets
FOR EACH ROW
BEGIN
  IF NOT (OLD.issue_description <=> NEW.issue_description AND OLD.status <=> NEW.status) THEN
    INSERT INTO ticket_audit (ticket_id, action, old_description, new_description, old_status, new_status, changed_by)
    VALUES (OLD.ticket_id, 'UPDATE', OLD.issue_description, NEW.issue_description, OLD.status, NEW.status, USER());  -- USER() = connecting account; CURRENT_USER() would be the trigger definer
  END IF;
END
--> statement-breakpoint

CREATE TRIGGER trg_ticket_after_delete AFTER DELETE ON maintenance_tickets
FOR EACH ROW
BEGIN
  INSERT INTO ticket_audit (ticket_id, action, old_description, old_status, changed_by)
  VALUES (OLD.ticket_id, 'DELETE', OLD.issue_description, OLD.status, USER());
END
--> statement-breakpoint

-- ---------- View ----------

CREATE VIEW daily_fleet_stats AS
SELECT
  a.asset_id,
  a.vehicle_id,
  a.brand,
  DATE(t.`timestamp`)                      AS day,
  COUNT(*)                                 AS readings,
  MAX(t.speed)                             AS max_speed_kph,
  ROUND(AVG(t.engine_temp_c), 2)           AS avg_engine_temp_c,
  MAX(t.engine_temp_c)                     AS max_engine_temp_c,
  ROUND(AVG(t.engine_rpm), 0)              AS avg_engine_rpm,
  ROUND(MAX(t.odometer) - MIN(t.odometer), 2) AS distance_km
FROM telemetry_logs t
JOIN fleet_assets a ON a.asset_id = t.asset_id
GROUP BY a.asset_id, a.vehicle_id, a.brand, DATE(t.`timestamp`)
--> statement-breakpoint

-- ---------- Functions & procedures ----------

CREATE FUNCTION fn_failure_count(p_asset INT) RETURNS INT
READS SQL DATA
BEGIN
  DECLARE n INT;
  SELECT COUNT(*) INTO n FROM maintenance_tickets WHERE asset_id = p_asset;
  RETURN n;
END
--> statement-breakpoint

CREATE PROCEDURE sp_resolve_ticket(IN p_ticket INT)
BEGIN
  DECLARE v_rows INT;
  UPDATE maintenance_tickets SET status = 'resolved' WHERE ticket_id = p_ticket AND status <> 'resolved';
  SET v_rows = ROW_COUNT();
  IF v_rows = 0 AND NOT EXISTS (SELECT 1 FROM maintenance_tickets WHERE ticket_id = p_ticket) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ticket not found';
  END IF;
END
--> statement-breakpoint

CREATE PROCEDURE sp_fleet_summary()
BEGIN
  SELECT a.brand,
         COUNT(DISTINCT a.asset_id)  AS vehicles,
         COUNT(t.log_id)             AS readings,
         ROUND(AVG(t.engine_temp_c), 1) AS avg_engine_temp_c,
         COUNT(DISTINCT CASE WHEN fn_failure_count(a.asset_id) > 0 THEN a.asset_id END) AS vehicles_with_failures
  FROM fleet_assets a
  LEFT JOIN telemetry_logs t ON t.asset_id = a.asset_id
  GROUP BY a.brand
  ORDER BY vehicles DESC, a.brand;
END
--> statement-breakpoint

-- Adds the monthly partition for a given day by splitting the catch-all pmax partition.
CREATE PROCEDURE ensure_telemetry_partition(IN p_day DATE)
BEGIN
  DECLARE v_start DATE DEFAULT DATE_FORMAT(p_day, '%Y-%m-01');
  DECLARE v_end   DATE DEFAULT DATE_ADD(DATE_FORMAT(p_day, '%Y-%m-01'), INTERVAL 1 MONTH);
  DECLARE v_name  VARCHAR(16) DEFAULT CONCAT('p', DATE_FORMAT(p_day, '%Y%m'));
  DECLARE v_exists INT DEFAULT 0;
  SELECT COUNT(*) INTO v_exists FROM information_schema.PARTITIONS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'telemetry_logs' AND PARTITION_NAME = v_name;
  IF v_exists = 0 AND v_start >= '2023-03-01' THEN
    SET @ddl = CONCAT('ALTER TABLE telemetry_logs REORGANIZE PARTITION pmax INTO (PARTITION ', v_name,
                      ' VALUES LESS THAN (''', v_end, '''), PARTITION pmax VALUES LESS THAN (MAXVALUE))');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END
