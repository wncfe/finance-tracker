package ru.ponedelyam.companion

import android.app.Application
import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class CompanionApp : Application() {
    val store by lazy { Store(this) }
    override fun onCreate() { super.onCreate(); Sync.schedule(this) }
}
fun Context.store() = (applicationContext as CompanionApp).store
object Sync {
    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("budget-periodic", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BudgetSync>(30, TimeUnit.MINUTES).setConstraints(network).build())
    }
    fun now(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork("budget-refresh", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<BudgetSync>().setConstraints(network).build())
    }
}
class BudgetSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = applicationContext.store()
        if (!store.read().has("token")) return Result.success()
        var result = Result.success()
        try { Api(store).sync() }
        catch(e: Exception) { result = if(e is ApiError && e.status == 401) Result.failure() else if(runAttemptCount < 3) Result.retry() else Result.failure() }
        refreshWidgets(applicationContext)
        return result
    }
}
