-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Order_accountId_idempotencyKey_key" ON "Order"("accountId", "idempotencyKey");

