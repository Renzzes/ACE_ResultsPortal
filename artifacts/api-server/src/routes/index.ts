import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import patientsRouter from "./patients";
import resultsRouter from "./results";
import portalRouter from "./portal";
import physicianRouter from "./physician";
import auditRouter from "./audit";
import dashboardRouter from "./dashboard";
import archiveRouter from "./archive";
import adminRouter from "./admin";
import notificationsRouter from "./notifications";
import announcementsRouter from "./announcements";
import messagesRouter from "./messages";
import portalMessagesRouter from "./portal-messages";
import supportRouter from "./support";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(patientsRouter);
router.use(resultsRouter);
router.use(portalRouter);
router.use(portalMessagesRouter);
router.use(physicianRouter);
router.use(auditRouter);
router.use(dashboardRouter);
router.use(archiveRouter);
router.use(adminRouter);
router.use(notificationsRouter);
router.use(announcementsRouter);
router.use(messagesRouter);
router.use(supportRouter);

export default router;
