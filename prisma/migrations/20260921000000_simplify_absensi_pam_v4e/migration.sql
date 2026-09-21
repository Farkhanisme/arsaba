-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "shiftMulai",
DROP COLUMN "shiftSelesai",
ADD COLUMN     "isPam" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShiftAssignment" DROP COLUMN "pamDariAssignmentId",
DROP COLUMN "pamKeterangan";

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "pamEnabled" BOOLEAN NOT NULL DEFAULT true;
