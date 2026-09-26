-- R1 follow-up (ADR-0005): which soft-deleted transaksi went to the trash *with* their
-- customer. Matching on deleted_at alone conflated a transaksi deleted on its own with
-- one deleted by the customer's cascade whenever both happened in the same second.
ALTER TABLE `transaksi` ADD `deleted_with_customer_id` integer REFERENCES customers(id);
