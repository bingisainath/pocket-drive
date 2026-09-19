package com.bingisainath.pocketdrive.uploader

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream

/**
 * Exercises the resumable upload protocol in [ResumableUpload] against a local MockWebServer,
 * covering the happy path and each recovery branch (409 resync, 404 restart, retryable backoff,
 * 401 stop, cancellation). Runs under Robolectric so android's Uri and org.json are real.
 */
@RunWith(RobolectricTestRunner::class)
// A plain Application, so Robolectric doesn't run MainApplication.onCreate (which inits SoLoader).
@Config(sdk = [34], application = Application::class)
class ResumableUploadTest {
  private lateinit var server: MockWebServer
  private lateinit var resolver: ContentResolver
  private lateinit var uri: Uri

  private val noop = object : ResumableUpload.Callbacks {
    override fun onProgress(uploaded: Long, total: Long) {}
    override fun onReconnecting(reconnecting: Boolean) {}
  }

  @Before
  fun setUp() {
    server = MockWebServer()
    server.start()
    resolver = mock(ContentResolver::class.java)
    uri = Uri.parse("content://test/file")
  }

  @After
  fun tearDown() {
    server.shutdown()
  }

  /** Fresh stream of [size] deterministic bytes each time the uploader opens the content URI. */
  private fun feed(size: Int) {
    val bytes = ByteArray(size) { (it % 256).toByte() }
    `when`(resolver.openInputStream(any())).thenAnswer { ByteArrayInputStream(bytes) }
  }

  private fun upload(size: Long) = ResumableUpload(
    resolver = resolver,
    baseUrl = server.url("/").toString().trimEnd('/'),
    token = "test-token",
    uri = uri,
    name = "photo.jpg",
    size = size,
    lastModified = 123L,
    folder = "/",
  )

  private fun open(id: String, offset: Long, chunkSize: Long) =
    MockResponse().setResponseCode(200)
      .setBody("""{"id":"$id","offset":$offset,"chunkSize":$chunkSize}""")

  private fun offset(value: Long) =
    MockResponse().setResponseCode(200).setBody("""{"offset":$value}""")

  private fun finished() =
    MockResponse().setResponseCode(200).setBody("""{"offset":8,"file":{"name":"photo.jpg"}}""")

  @Test
  fun `happy path uploads all chunks and returns the file`() {
    feed(8)
    server.enqueue(open("A", 0, 4))
    server.enqueue(offset(4)) // first chunk 0..4
    server.enqueue(finished()) // second chunk 4..8

    val file = upload(8).run(noop)

    assertEquals("photo.jpg", file.getString("name"))
    assertEquals("POST", server.takeRequest().method) // open
    val put1 = server.takeRequest()
    assertEquals("PUT", put1.method)
    assertEquals("0", put1.getHeader("Upload-Offset"))
    val put2 = server.takeRequest()
    assertEquals("4", put2.getHeader("Upload-Offset"))
  }

  @Test
  fun `409 resyncs to the server's offset`() {
    feed(8)
    server.enqueue(open("A", 0, 4))
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"offset":4}"""))
    server.enqueue(finished()) // resumes at offset 4

    val file = upload(8).run(noop)

    assertEquals("photo.jpg", file.getString("name"))
    server.takeRequest() // POST
    server.takeRequest() // PUT @0 -> 409
    assertEquals("4", server.takeRequest().getHeader("Upload-Offset")) // PUT @4
  }

  @Test
  fun `404 restarts the session`() {
    feed(8)
    server.enqueue(open("A", 0, 8))
    server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"gone"}"""))
    server.enqueue(open("B", 0, 8)) // reopened
    server.enqueue(finished())

    val file = upload(8).run(noop)

    assertEquals("photo.jpg", file.getString("name"))
    assertEquals("POST", server.takeRequest().method)
    assertEquals("PUT", server.takeRequest().method)
    assertEquals("POST", server.takeRequest().method) // reopen
    assertEquals("PUT", server.takeRequest().method)
  }

  @Test
  fun `retryable error backs off then continues`() {
    feed(8)
    server.enqueue(open("A", 0, 8))
    server.enqueue(MockResponse().setResponseCode(503))
    server.enqueue(offset(0)) // GET current offset after backoff
    server.enqueue(finished())

    val file = upload(8).run(noop)

    assertEquals("photo.jpg", file.getString("name"))
    assertEquals("POST", server.takeRequest().method)
    assertEquals("PUT", server.takeRequest().method) // 503
    assertEquals("GET", server.takeRequest().method) // offset probe
    assertEquals("PUT", server.takeRequest().method)
  }

  @Test
  fun `401 stops the upload`() {
    feed(8)
    server.enqueue(open("A", 0, 8))
    server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}"""))

    val error = runCatching { upload(8).run(noop) }.exceptionOrNull()

    assertTrue("expected an exception on 401", error is Exception)
  }

  @Test
  fun `cancellation stops mid-upload`() {
    feed(40)
    server.enqueue(open("A", 0, 20))
    server.enqueue(offset(20)) // first chunk completes, more remain

    val subject = upload(40)
    val cancelling = object : ResumableUpload.Callbacks {
      override fun onProgress(uploaded: Long, total: Long) {
        if (uploaded >= 20) subject.cancel()
      }
      override fun onReconnecting(reconnecting: Boolean) {}
    }

    val error = runCatching { subject.run(cancelling) }.exceptionOrNull()

    assertTrue("expected CancelledException", error is ResumableUpload.CancelledException)
  }
}
