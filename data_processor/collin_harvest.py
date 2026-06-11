"""
Collin County Election Data Harvest Engine

Harvests election data from Collin County's election results archive.
Discovers election pages, downloads CSV/export files, and generates a master index.
"""

import os
import re
import time
import csv
import logging
from urllib.parse import urljoin, urlparse
from pathlib import Path
import requests
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CollinElectionDataEngine:
    """
    Harvests election data from Collin County's election results archive.
    """
    
    def __init__(self, base_url="https://www.collincountytx.gov/Elections/election-results-archive",
                 output_dir="collin_elections_master", include_pattern=None):
        """
        Initialize the harvest engine.

        Args:
            base_url: Base URL for the election results archive
            output_dir: Directory to store downloaded files
            include_pattern: Optional regex; only files whose link text or
                filename matches are downloaded (case-insensitive)
        """
        self.base_url = base_url
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.include_pattern = re.compile(include_pattern, re.IGNORECASE) if include_pattern else None

        # File extensions for parseable data files (direct-download mode)
        self.data_extensions = ('.csv', '.xlsx', '.xls')

        # Keywords for identifying election-related links
        self.election_keywords = ['election', 'results', '2026', '2025', '2024', '2022', '2020', '2018',
                                  'general', 'primary', 'runoff', 'special']
        
        # Keywords for identifying downloadable/parseable files
        self.file_keywords = ['csv', 'export', 'all races', 'results', 'download', 
                             'precinct', 'data', 'excel', 'xlsx', 'xls']
        
        # Rate limiting delay between requests (seconds)
        self.request_delay = 1.0
        
    def fetch_archive_pages(self):
        """
        Fetch the archive page and discover election landing page URLs.
        
        Returns:
            List of election page URLs
        """
        logger.info(f"Fetching archive page: {self.base_url}")
        
        try:
            response = requests.get(self.base_url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch archive page: {e}")
            return []
        
        soup = BeautifulSoup(response.content, 'html.parser')
        election_links = []
        
        # Find all links on the page
        for link in soup.find_all('a', href=True):
            href = link.get('href', '').strip()
            link_text = link.get_text(strip=True).lower()
            
            # Check if href or link text contains election-related keywords
            href_lower = href.lower()
            if any(keyword in href_lower or keyword in link_text for keyword in self.election_keywords):
                # Convert relative URLs to absolute
                full_url = urljoin(self.base_url, href)
                
                # Avoid duplicates and non-HTTP(S) URLs
                if full_url not in election_links and full_url.startswith(('http://', 'https://')):
                    election_links.append(full_url)
                    logger.debug(f"Found election link: {full_url}")
        
        logger.info(f"Discovered {len(election_links)} election pages")
        return election_links
    
    def extract_parseable_files(self, election_page_url):
        """
        Extract parseable file links from an election page.
        
        Args:
            election_page_url: URL of the election landing page
            
        Returns:
            List of dicts: {election, file_name, source_url, local_path}
        """
        logger.info(f"Extracting files from: {election_page_url}")
        
        try:
            response = requests.get(election_page_url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch election page {election_page_url}: {e}")
            return []
        
        soup = BeautifulSoup(response.content, 'html.parser')
        downloaded_files = []
        
        # Extract election name from URL or page title
        parsed_url = urlparse(election_page_url)
        election_name = parsed_url.path.strip('/').split('/')[-1] or "unknown_election"
        election_name = re.sub(r'[^\w\-]', '_', election_name)
        
        # Create directory for this election
        election_dir = self.output_dir / election_name
        election_dir.mkdir(parents=True, exist_ok=True)
        
        # Find all links that might be downloadable files
        for link in soup.find_all('a', href=True):
            href = link.get('href', '').strip()
            link_text = link.get_text(strip=True).lower()
            
            # Check if link text or href contains file-related keywords
            href_lower = href.lower()
            if any(keyword in href_lower or keyword in link_text for keyword in self.file_keywords):
                # Convert to absolute URL
                file_url = urljoin(election_page_url, href)
                
                # Extract filename from URL or link text
                parsed_file_url = urlparse(file_url)
                file_name = os.path.basename(parsed_file_url.path)
                
                # If no filename in URL, use link text
                if not file_name or '.' not in file_name:
                    file_name = link_text.replace(' ', '_')[:50] + '.csv'
                
                # Sanitize filename
                file_name = re.sub(r'[^\w\.\-]', '_', file_name)
                if not file_name.endswith(('.csv', '.xlsx', '.xls')):
                    file_name += '.csv'
                
                local_path = election_dir / file_name
                
                # Download the file
                try:
                    logger.info(f"Downloading: {file_url} -> {local_path}")
                    file_response = requests.get(file_url, timeout=60, stream=True)
                    file_response.raise_for_status()
                    
                    # Write file
                    with open(local_path, 'wb') as f:
                        for chunk in file_response.iter_content(chunk_size=8192):
                            f.write(chunk)
                    
                    downloaded_files.append({
                        'election': election_name,
                        'file_name': file_name,
                        'source_url': file_url,
                        'local_path': str(local_path)
                    })
                    
                    logger.info(f"Downloaded: {file_name}")
                    
                    # Rate limiting
                    time.sleep(self.request_delay)
                    
                except requests.RequestException as e:
                    logger.warning(f"Failed to download {file_url}: {e}")
                    continue
        
        logger.info(f"Extracted {len(downloaded_files)} files from {election_page_url}")
        return downloaded_files
    
    @staticmethod
    def unwrap_multipart_envelope(local_path):
        """
        Unwrap a multipart/form-data envelope around a downloaded file.

        The county's CMS (Sitefinity) serves some documents wrapped in a
        single-part multipart envelope:
            --<boundary>\r\n<headers>\r\n\r\n<payload>\r\n--<boundary>--\r\n
        If detected, rewrite the file with just the payload bytes.
        """
        path = Path(local_path)
        data = path.read_bytes()
        if not data.startswith(b'--') or b'Content-Disposition' not in data[:1024]:
            return False
        boundary = data.split(b'\r\n', 1)[0]
        header_end = data.find(b'\r\n\r\n')
        if header_end == -1:
            return False
        payload = data[header_end + 4:]
        closing = b'\r\n' + boundary + b'--'
        end = payload.rfind(closing)
        if end != -1:
            payload = payload[:end]
        path.write_bytes(payload)
        logger.info(f"Unwrapped multipart envelope: {path.name}")
        return True

    def collect_direct_file_links(self, soup):
        """
        Collect direct data-file links (.csv/.xlsx/.xls) from a page.

        The county redesigned the archive page (2025+): instead of linking to
        per-election landing pages, it now links directly to result documents
        (PDF reports plus CSV/Excel precinct exports). This collects only the
        parseable data files.

        Args:
            soup: BeautifulSoup of the archive page

        Returns:
            List of dicts: {file_url, link_text}
        """
        links = []
        seen = set()
        for link in soup.find_all('a', href=True):
            href = link.get('href', '').strip()
            link_text = link.get_text(strip=True)
            # Strip query string (Sitefinity appends ?sfvrsn=...)
            path = urlparse(urljoin(self.base_url, href)).path.lower()
            if not path.endswith(self.data_extensions):
                continue
            file_url = urljoin(self.base_url, href)
            if file_url in seen:
                continue
            seen.add(file_url)
            # Apply include filter (link text or URL filename)
            file_name = os.path.basename(urlparse(file_url).path)
            if self.include_pattern and not (
                    self.include_pattern.search(link_text) or
                    self.include_pattern.search(file_name)):
                continue
            links.append({'file_url': file_url, 'link_text': link_text})
        return links

    def harvest_direct_files(self, direct_links):
        """
        Download direct data-file links found on the archive page.

        Args:
            direct_links: List of {file_url, link_text} dicts

        Returns:
            List of file metadata dicts (same shape as extract_parseable_files)
        """
        downloaded_files = []

        for item in direct_links:
            file_url = item['file_url']
            link_text = item['link_text']

            parsed_file_url = urlparse(file_url)
            file_name = os.path.basename(parsed_file_url.path)
            file_name = re.sub(r'[^\w\.\-]', '_', file_name)

            # One directory per election, named after the file stem
            election_name = re.sub(r'[^\w\-]', '_', Path(file_name).stem)
            election_dir = self.output_dir / election_name
            election_dir.mkdir(parents=True, exist_ok=True)
            local_path = election_dir / file_name

            try:
                logger.info(f"Downloading: {file_url} -> {local_path}")
                file_response = requests.get(file_url, timeout=60, stream=True)
                file_response.raise_for_status()

                with open(local_path, 'wb') as f:
                    for chunk in file_response.iter_content(chunk_size=8192):
                        f.write(chunk)

                # Some CMS documents are served inside a multipart envelope
                self.unwrap_multipart_envelope(local_path)

                downloaded_files.append({
                    'election': election_name,
                    'file_name': file_name,
                    'source_url': file_url,
                    'local_path': str(local_path)
                })

                logger.info(f"Downloaded: {file_name}")
                time.sleep(self.request_delay)

            except requests.RequestException as e:
                logger.warning(f"Failed to download {file_url}: {e}")
                continue

        logger.info(f"Direct-download mode: {len(downloaded_files)} files downloaded")
        return downloaded_files

    def infer_year_and_type(self, url, filename, election_name):
        """
        Infer year and election type from URL, filename, or election name.
        
        Args:
            url: Source URL
            filename: Downloaded filename
            election_name: Election name from URL path
            
        Returns:
            Tuple of (year, election_type)
        """
        year = None
        election_type = None
        
        # Extract year from URL, filename, or election name
        year_pattern = r'\b(20\d{2})\b'
        for text in [url, filename, election_name]:
            match = re.search(year_pattern, text)
            if match:
                year = int(match.group(1))
                break
        
        # Infer election type from URL or filename
        text_lower = (url + ' ' + filename + ' ' + election_name).lower()
        
        if any(term in text_lower for term in ['president', 'senator', 'us representative', 'united states']):
            election_type = 'federal'
        elif any(term in text_lower for term in ['governor', 'lieutenant governor', 'attorney general', 
                                                  'comptroller', 'state representative', 'state senator',
                                                  'railroad commissioner', 'supreme court', 'court of appeals']):
            election_type = 'state'
        elif any(term in text_lower for term in ['county commissioner', 'sheriff', 'constable', 
                                                  'county judge', 'district judge', 'county tax']):
            election_type = 'county'
        elif any(term in text_lower for term in ['city', 'mayor', 'city council', 'alderman']):
            election_type = 'local'
        elif any(term in text_lower for term in ['isd', 'school trustee']):
            election_type = 'isd'
        elif any(term in text_lower for term in ['mud']):
            election_type = 'mud'
        else:
            election_type = 'unknown'
        
        return year, election_type
    
    def generate_master_index(self, all_data):
        """
        Generate a master index CSV of all downloaded files.
        
        Args:
            all_data: List of file metadata dicts from extract_parseable_files
            
        Returns:
            Path to the generated index CSV
        """
        index_path = self.output_dir / 'collin_election_data_index.csv'
        
        logger.info(f"Generating master index: {index_path}")
        
        with open(index_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'election', 'year', 'file_name', 'source_url', 'local_path', 'election_type'
            ])
            writer.writeheader()
            
            for item in all_data:
                year, election_type = self.infer_year_and_type(
                    item['source_url'],
                    item['file_name'],
                    item['election']
                )
                
                writer.writerow({
                    'election': item['election'],
                    'year': year or '',
                    'file_name': item['file_name'],
                    'source_url': item['source_url'],
                    'local_path': item['local_path'],
                    'election_type': election_type
                })
        
        logger.info(f"Master index written: {index_path}")
        return index_path
    
    def run(self, limit=None):
        """
        Run the full harvest process.
        
        Args:
            limit: Optional limit on number of election pages to process
            
        Returns:
            List of all downloaded file metadata
        """
        logger.info("Starting harvest process")

        # Fetch the archive page once and check for direct data-file links
        # (new site structure, 2025+). Fall back to legacy page-crawl mode.
        logger.info(f"Fetching archive page: {self.base_url}")
        try:
            response = requests.get(self.base_url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch archive page: {e}")
            return []

        soup = BeautifulSoup(response.content, 'html.parser')
        direct_links = self.collect_direct_file_links(soup)

        if direct_links:
            logger.info(f"Archive page links directly to {len(direct_links)} data files; "
                        "using direct-download mode")
            if limit:
                direct_links = direct_links[:limit]
            master_results = self.harvest_direct_files(direct_links)
            if master_results:
                self.generate_master_index(master_results)
            logger.info(f"Harvest complete: {len(master_results)} files downloaded")
            return master_results

        # Legacy mode: discover election landing pages and crawl each
        election_links = self.fetch_archive_pages()

        if not election_links:
            logger.warning("No election pages found")
            return []
        
        # Apply limit if specified
        if limit:
            election_links = election_links[:limit]
            logger.info(f"Processing first {limit} election pages")
        
        master_results = []
        
        # Process each election page
        for i, election_url in enumerate(election_links, 1):
            logger.info(f"Processing election {i}/{len(election_links)}: {election_url}")
            
            files = self.extract_parseable_files(election_url)
            master_results.extend(files)
            
            # Rate limiting between pages
            if i < len(election_links):
                time.sleep(self.request_delay)
        
        # Generate master index
        if master_results:
            self.generate_master_index(master_results)
        
        logger.info(f"Harvest complete: {len(master_results)} files downloaded")
        return master_results


if __name__ == '__main__':
    # Example usage
    engine = CollinElectionDataEngine()
    results = engine.run(limit=10)
    print(f"\nHarvest complete: {len(results)} files downloaded")
    print(f"Results saved to: {engine.output_dir}")
