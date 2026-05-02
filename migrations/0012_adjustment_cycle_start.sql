-- Anchor timestamp used to interpret legacy cycle-based leave adjustments.
ALTER TABLE employees ADD COLUMN leave_adjustment_cycle_start TEXT;
