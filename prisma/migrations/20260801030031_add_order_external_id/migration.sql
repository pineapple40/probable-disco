-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "externalOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_externalOrderId_key" ON "Order"("externalOrderId");
