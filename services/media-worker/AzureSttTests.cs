using System.Net;
using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class AzureSttTests
{
    [Fact]
    public async Task ParsesDisplayTextFromSpeechRest()
    {
        var handler = new StubHandler("""{"RecognitionStatus":"Success","DisplayText":"Mirror 44."}""");
        var stt = new AzureStt("key", "uksouth", http: new HttpClient(handler));
        var text = await stt.RecognizeWavAsync(PcmWav.Wrap16kMono(new byte[320]));
        Assert.Equal("Mirror 44.", text);
        Assert.Contains("stt.speech.microsoft.com", handler.LastUri ?? "", StringComparison.OrdinalIgnoreCase);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly string _json;
        public string? LastUri { get; private set; }
        public StubHandler(string json) => _json = json;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastUri = request.RequestUri?.ToString();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_json, System.Text.Encoding.UTF8, "application/json"),
            });
        }
    }
}
