/*
  Warnings:

  - You are about to alter the column `reason` on the `points_transactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.

*/
-- AlterTable
ALTER TABLE "points_transactions" ALTER COLUMN "reason" SET DATA TYPE VARCHAR(255);
